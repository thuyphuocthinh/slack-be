import { Injectable, Logger } from '@nestjs/common';
import {
  ORCHESTRATION_CONSTANTS,
  SUPERVISOR_PLANNING_PROMPT,
  SUPERVISOR_EVALUATE_PROMPT,
  SUPERVISOR_EVALUATE_SCHEMA,
  SUPERVISOR_SYNTHESIS_PROMPT,
  SUPERVISOR_PLAN_SCHEMA,
  SUPERVISOR_PLAN_SCHEMA_NO_ANSWER,
  PROVIDER_DESCRIPTIONS,
} from '@slack/constants';
import { McpAuthClientService } from '../mcp-auth/mcp-auth-client.service';
import { AGENT_REGISTRY } from '../registry/agents.registry';
import { DynamicProviderDbService } from '../registry/dynamic-provider-db.service';
import { OpenAiEmbeddingProvider } from '../registry/openai-embedding.provider';
import { SemanticToolIndex } from '../common/agentic-openapi-parser';
import {
  AvailableAgentDto,
  DelegationDto,
  SupervisorEvaluateDto,
  SupervisorPlanDto,
  SupervisorRoundDto,
} from '../dto/supervisor.dto';
import { ChatHistoryTurnDto } from '../dto/message-client.dto';
import { LlmStrategyFactory } from './strategy/llm-strategy.factory';
import { describeExternalServiceError } from './external-service-error.util';
import { withTimeout } from './with-timeout.util';
import { CircuitBreakerService } from '../common/circuit-breaker.service';

@Injectable()
export class SupervisorService {
  private readonly logger = new Logger(SupervisorService.name);

  constructor(
    private readonly mcpAuthClient: McpAuthClientService,
    private readonly llmFactory: LlmStrategyFactory,
    private readonly circuitBreaker: CircuitBreakerService,
    private readonly dynamicProviderDb: DynamicProviderDbService,
    private readonly embeddingProvider: OpenAiEmbeddingProvider,
  ) {}

  /**
   * Agent "khả dụng" cho Supervisor = vừa đã connect (mcp-auth) VỪA có hạ
   * tầng thật đăng ký trong AGENT_REGISTRY — agent chưa deploy (registry
   * rỗng endpoint) không được đưa vào lựa chọn dù user có connect provider đó.
   */
  async getAvailableAgents(userId: string): Promise<AvailableAgentDto[]> {
    const statuses = await this.mcpAuthClient.getConnectionStatus(userId);
    const staticAgents = statuses
      .filter(
        (status) =>
          status.is_connected && AGENT_REGISTRY[status.provider_id]?.endpoint,
      )
      .map((status) => ({
        provider: status.provider_id,
        label: AGENT_REGISTRY[status.provider_id].label,
        description: PROVIDER_DESCRIPTIONS[status.provider_id] ?? '',
      }));

    const dynamicEntities =
      await this.dynamicProviderDb.getProvidersByUser(userId);
    const dynamicAgents = dynamicEntities.map((entity) => ({
      provider: entity.id,
      label: entity.name,
      description:
        entity.description ||
        `Hệ thống/API mở rộng (Custom Swagger). TRỌNG TÂM: Hãy ưu tiên chọn agent này nếu yêu cầu liên quan đến các từ khóa hoặc dữ liệu thuộc về hệ thống "${entity.name}" (URL tham khảo: ${entity.specUrl}).`,
    }));

    return [...staticAgents, ...dynamicAgents];
  }

  /**
   * Giai đoạn Accuracy v2, mục 2 (xem accuracy.v2.md) — agent-level Tool RAG.
   * Tái dùng CHÍNH `SemanticToolIndex` đã dùng cho Tool RAG ở tầng tool (1
   * dynamic provider nhiều tool) — áp dụng lên tầng agent: khi user connect
   * nhiều agent, `agentListText` (plan()) trước đây liệt kê hết KHÔNG rank,
   * đúng kiểu vấn đề "quá nhiều lựa chọn không rank làm accuracy rớt" (tương
   * tự tool >128 phải rank). Dưới ngưỡng `MAX_AGENTS_BEFORE_RANKING` — giữ
   * nguyên hành vi cũ (trả nguyên `agents`, không tốn lời gọi embedding nào).
   *
   * Build lại index MỖI LẦN gọi (không cache theo user) — agent list nhỏ
   * (ngưỡng kích hoạt mới ở mức chục) và `plan()` giờ chỉ gọi 1 lần/turn
   * (Plan-and-Execute, không phải mỗi round như decide() cũ), nên chi phí
   * không đáng kể so với lợi ích tránh cache-invalidation khi user connect/
   * ngắt kết nối agent giữa chừng.
   */
  private async rankAgentsForPrompt(
    prompt: string,
    agents: AvailableAgentDto[],
  ): Promise<{ shown: AvailableAgentDto[]; omittedCount: number }> {
    if (agents.length <= ORCHESTRATION_CONSTANTS.MAX_AGENTS_BEFORE_RANKING) {
      return { shown: agents, omittedCount: 0 };
    }

    try {
      const index = new SemanticToolIndex<AvailableAgentDto & { name: string }>(
        this.embeddingProvider,
      );
      await index.build(agents.map((a) => ({ ...a, name: a.label })));
      const ranked = await index.search(
        prompt,
        ORCHESTRATION_CONSTANTS.AGENT_RANKING_TOP_K,
      );
      if (ranked.length === 0) return { shown: agents, omittedCount: 0 };
      return { shown: ranked, omittedCount: agents.length - ranked.length };
    } catch (error) {
      this.logger.warn(
        `rankAgentsForPrompt() lỗi, fallback về liệt kê hết ${agents.length} agent: ${(error as Error).message}`,
      );
      return { shown: agents, omittedCount: 0 };
    }
  }

  /**
   * accuracy_problem.md mục 1, bước 1 — đo tần suất case positional bias thật
   * ở production (đã xác nhận qua thực nghiệm ở accuracy.v2.md mục 6: khi 2+
   * agent mô tả tương tự nhau, plan() luôn chọn agent đứng ĐẦU mảng, không hề
   * lộ tín hiệu bất định). Thuần quan sát — KHÔNG đổi kết quả plan(), KHÔNG
   * gọi thêm LLM/embedding nào (so sánh từ vựng - Jaccard, rẻ, tức thời) —
   * chỉ log để đếm tần suất, quyết định mục 6 (accuracy.v2.md) có đáng xây
   * HITL clarification UI hay không dựa trên con số đo được.
   */
  private logAmbiguousAgentClusterIfAny(
    agents: AvailableAgentDto[],
    chosenProvider: string,
  ): void {
    const chosen = agents.find((a) => a.provider === chosenProvider);
    if (!chosen) return;

    const tokenize = (text: string) =>
      new Set(text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []);
    const chosenTokens = tokenize(chosen.description);

    const similarOthers = agents.filter((a) => {
      if (a.provider === chosenProvider) return false;
      const otherTokens = tokenize(a.description);
      const intersectionSize = [...chosenTokens].filter((t) =>
        otherTokens.has(t),
      ).length;
      const unionSize = new Set([...chosenTokens, ...otherTokens]).size;
      const jaccard = unionSize === 0 ? 0 : intersectionSize / unionSize;
      return (
        jaccard >= ORCHESTRATION_CONSTANTS.AMBIGUOUS_AGENT_JACCARD_THRESHOLD
      );
    });

    if (similarOthers.length === 0) return;

    this.logger.warn(
      `[ambiguous-agent-cluster] plan() chọn "${chosenProvider}" giữa ${similarOthers.length + 1} agent mô tả tương tự nhau — candidates=${[chosenProvider, ...similarOthers.map((a) => a.provider)].join(',')}`,
    );
  }

  /**
   * Plan-and-Execute (xem accuracy.md) — thay cho decide() cũ (hỏi lại "làm
   * gì tiếp" mỗi round). Gọi ĐÚNG 1 LẦN mỗi khi TurnResolverService.continueRounds()
   * cần 1 kế hoạch mới (turn mới HOẶC re-plan giữa chừng) — trả về TOÀN BỘ các
   * bước còn lại, không chỉ bước tiếp theo.
   *
   * `rounds`: các bước ĐÃ chạy xong trong CÙNG 1 turn (có thể qua nhiều lần
   * duyệt HITL) — không phải lịch sử chat cũ. `history`: lịch sử hội thoại gần
   * đây trong channel (Step 7 — trước đây chỉ SubAgent nhìn thấy, Supervisor mù
   * hoàn toàn nên dễ route sai với câu hỏi nối ngữ cảnh cũ).
   */
  async plan(
    prompt: string,
    agents: AvailableAgentDto[],
    rounds: SupervisorRoundDto[] = [],
    history: ChatHistoryTurnDto[] = [],
  ): Promise<SupervisorPlanDto> {
    const { shown, omittedCount } = await this.rankAgentsForPrompt(
      prompt,
      agents,
    );
    const agentListText =
      shown.length > 0
        ? shown
            .map((a) => `- ${a.provider} (${a.label}): ${a.description}`)
            .join('\n') +
          (omittedCount > 0
            ? `\n(Còn ${omittedCount} hệ thống khác đã kết nối nhưng không liên quan tới câu hỏi này, đã ẩn bớt khỏi danh sách trên.)`
            : '')
        : '(Người dùng chưa kết nối agent nào — nếu câu hỏi cần dữ liệu, trả lời "respond" và nhắc user vào Settings để kết nối.)';

    const fullPrompt = this.buildPrompt(prompt, rounds, history);
    // continueRounds() CHỈ dùng plan.answer khi rounds rỗng (chưa chạy bước
    // nào) — mọi lần plan() sau đều tự tổng hợp lại (rounds[0].result hoặc
    // synthesize(), xem "stream = save"). Bỏ field "answer" khỏi schema ở các
    // lần đó để khỏi trả tiền completion token cho 1 câu trả lời chắc chắn bị vứt.
    const planSchema =
      rounds.length > 0
        ? SUPERVISOR_PLAN_SCHEMA_NO_ANSWER
        : SUPERVISOR_PLAN_SCHEMA;

    try {
      // Giai đoạn Accuracy v2, mục 4 — model tiering theo độ khó. `plan()` là
      // bước suy luận khó nhất (chọn agent, thứ tự bước) nhưng tần suất THẤP
      // NHẤT (1 lần/kế hoạch, không phải 1 lần/round như decide() cũ) — dư địa
      // dùng model mạnh hơn mà không đội chi phí đáng kể. Tách biến môi trường
      // RIÊNG cho plan(), không đụng evaluate()/synthesize(). Không set
      // SUPERVISOR_PLANNING_MODEL → rơi về đúng hành vi cũ (SUPERVISOR_MODEL).
      const { strategy, model } = this.llmFactory.resolve(
        process.env.SUPERVISOR_PLANNING_MODEL ??
          process.env.SUPERVISOR_MODEL ??
          ORCHESTRATION_CONSTANTS.SUPERVISOR_MODEL,
      );
      this.logger.log(
        `plan() model=${model} agents=${agents.length} historyTurns=${history.length} prompt=${fullPrompt}`,
      );
      // Giai đoạn 4, Step 6 — circuit breaker theo `strategy.id`, DÙNG CHUNG
      // key với ReactLoopService (cùng provider LLM chết thì cùng 1 mạch).
      const plan = await this.circuitBreaker.run(`llm:${strategy.id}`, () =>
        withTimeout(
          strategy.generateStructured<SupervisorPlanDto>({
            model,
            systemInstruction: `${SUPERVISOR_PLANNING_PROMPT}\n${agentListText}`,
            prompt: fullPrompt,
            schema: planSchema,
          }),
          ORCHESTRATION_CONSTANTS.LLM_CALL_TIMEOUT_MS,
          `Supervisor plan() timeout sau ${ORCHESTRATION_CONSTANTS.LLM_CALL_TIMEOUT_MS / 1000}s (model=${model})`,
        ),
      );
      this.logger.log(`plan() result=${JSON.stringify(plan)}`);
      if (plan.action === 'plan' && plan.steps?.[0]) {
        this.logAmbiguousAgentClusterIfAny(shown, plan.steps[0].agent);
      }
      return plan;
    } catch (error) {
      this.logger.error(
        `Supervisor plan() failed: ${(error as Error).message}`,
        (error as Error).stack,
      );
      return { action: 'respond', answer: describeExternalServiceError(error) };
    }
  }

  /**
   * Plan-and-Execute — gọi SAU MỖI bước trong kế hoạch, TRƯỚC khi qua bước kế
   * tiếp. Câu hỏi HẸP, rẻ hơn plan() (không suy luận lại cả nhiệm vụ). Không
   * còn bước nào trong kế hoạch (`remainingSteps` rỗng) thì khỏi cần hỏi LLM
   * — chắc chắn "done" (không có gì để "tiếp tục" hay "re-plan" nữa).
   */
  async evaluate(
    originalPrompt: string,
    completedStep: SupervisorRoundDto,
    remainingSteps: DelegationDto[],
  ): Promise<SupervisorEvaluateDto> {
    if (remainingSteps.length === 0) {
      return { verdict: 'done' };
    }

    // accuracy_problem.md — ĐÃ BỎ shortcut rule-based "kết quả không rỗng và
    // không khớp 2 cụm lỗi đã biết → coi là thành công, khỏi hỏi LLM". Sai ở
    // chỗ: "không thấy lỗi rành rành" KHÔNG đồng nghĩa "đúng ý user" — đây là
    // phán đoán NGỮ NGHĨA (kết quả có liên quan/đủ cho originalPrompt không),
    // so chuỗi không đủ khả năng đánh giá việc này. Luôn hỏi LLM (có
    // originalPrompt) khi còn bước phía sau — chấp nhận tốn thêm lời gọi LLM
    // để không bỏ lọt case "trông ổn nhưng lạc đề".
    const remainingText = remainingSteps
      .map((s, i) => `${i + 1}. Agent "${s.agent}": ${s.task}`)
      .join('\n');
    const prompt = `Câu hỏi gốc: ${originalPrompt}\n\nBước vừa thực hiện xong — Agent "${completedStep.agent}" (yêu cầu: "${completedStep.task}") → kết quả: ${completedStep.result}\n\nCác bước CÒN LẠI trong kế hoạch (chưa chạy):\n${remainingText}\n\nBước vừa xong có đạt kỳ vọng không, các bước còn lại có còn hợp lý để tiếp tục không?`;

    try {
      const { strategy, model } = this.llmFactory.resolve(
        process.env.SUPERVISOR_MODEL ??
          ORCHESTRATION_CONSTANTS.SUPERVISOR_MODEL,
      );
      const verdict = await this.circuitBreaker.run(`llm:${strategy.id}`, () =>
        withTimeout(
          strategy.generateStructured<SupervisorEvaluateDto>({
            model,
            systemInstruction: SUPERVISOR_EVALUATE_PROMPT,
            prompt,
            schema: SUPERVISOR_EVALUATE_SCHEMA,
          }),
          ORCHESTRATION_CONSTANTS.LLM_CALL_TIMEOUT_MS,
          `Supervisor evaluate() timeout sau ${ORCHESTRATION_CONSTANTS.LLM_CALL_TIMEOUT_MS / 1000}s (model=${model})`,
        ),
      );
      this.logger.log(`evaluate() result=${JSON.stringify(verdict)}`);
      return verdict;
    } catch (error) {
      this.logger.error(
        `Supervisor evaluate() failed: ${(error as Error).message}`,
        (error as Error).stack,
      );
      // Lỗi gọi LLM không nên chặn cả turn — mặc định bám theo kế hoạch cũ,
      // an toàn hơn vì MAX_SUPERVISOR_ROUNDS vẫn là lưới chặn cuối nếu kế
      // hoạch thật sự sai.
      return { verdict: 'continue' };
    }
  }

  /**
   * Gọi khi đã hết MAX_SUPERVISOR_ROUNDS mà vẫn chưa "respond" — bắt buộc
   * tổng hợp NGAY những gì đã thu thập được (Step 9), thay vì trả thẳng kết
   * quả thô của vòng cuối (có thể chỉ là 1 phần nhỏ của câu hỏi lớn).
   */
  async synthesize(
    originalPrompt: string,
    rounds: SupervisorRoundDto[],
    onToken?: (chunk: string) => void,
    signal?: AbortSignal,
  ): Promise<string> {
    const roundsText = rounds
      .map(
        (r, i) =>
          `${i + 1}. Agent "${r.agent}" (yêu cầu: "${r.task}") → kết quả: ${r.result}`,
      )
      .join('\n');

    try {
      const { strategy, model } = this.llmFactory.resolve(
        process.env.SUPERVISOR_MODEL ??
          ORCHESTRATION_CONSTANTS.SUPERVISOR_MODEL,
      );

      const session = strategy.startChat({
        model,
        systemInstruction: SUPERVISOR_SYNTHESIS_PROMPT,
        tools: [],
        history: [],
      });

      const prompt = `Câu hỏi gốc: ${originalPrompt}\n\nDữ liệu đã thu thập được:\n${roundsText}\n\nHãy tổng hợp các dữ liệu trên thành một câu trả lời hoàn chỉnh cho người dùng.`;

      const result = await this.circuitBreaker.run(`llm:${strategy.id}`, () =>
        withTimeout(
          session.sendMessage(prompt, onToken, signal),
          ORCHESTRATION_CONSTANTS.LLM_CALL_TIMEOUT_MS,
          `Supervisor synthesize() timeout sau ${ORCHESTRATION_CONSTANTS.LLM_CALL_TIMEOUT_MS / 1000}s (model=${model})`,
        ),
      );
      this.logger.log(`synthesize() result=${result.text}`);
      return result.text;
    } catch (error) {
      this.logger.error(
        `Supervisor synthesize() failed: ${(error as Error).message}`,
        (error as Error).stack,
      );
      return describeExternalServiceError(error);
    }
  }

  /** Gộp lịch sử hội thoại (nếu có) + prompt gốc + các vòng delegate đã chạy (nếu có) thành 1 prompt duy nhất. */
  private buildPrompt(
    originalPrompt: string,
    previousRounds: SupervisorRoundDto[],
    history: ChatHistoryTurnDto[],
  ): string {
    const sections: string[] = [];

    if (history.length > 0) {
      const historyText = history
        .map((h) =>
          h.role === 'model'
            ? 'AI: (nội dung câu trả lời cũ đã ẩn khỏi ngữ cảnh này — KHÔNG được dùng làm dữ liệu; nếu câu hỏi hiện tại cần dữ liệu/số liệu cụ thể, PHẢI delegate lại để lấy MỚI)'
            : `User: ${h.text}`,
        )
        .join('\n');
      sections.push(
        `Lịch sử hội thoại gần đây (chỉ để hiểu ngữ cảnh câu hỏi của user, KHÔNG phải yêu cầu mới):\n${historyText}`,
      );
    }

    sections.push(`Câu hỏi gốc của user: ${originalPrompt}`);

    if (previousRounds.length > 0) {
      const roundsText = previousRounds
        .map(
          (r, i) =>
            `${i + 1}. Đã delegate agent "${r.agent}" với yêu cầu "${r.task}" → kết quả: ${r.result}`,
        )
        .join('\n');
      sections.push(
        `Các bước đã thực hiện trong turn này:\n${roundsText}\n\nDựa vào kết quả trên, quyết định tiếp theo.`,
      );
    }

    return sections.join('\n\n');
  }
}
