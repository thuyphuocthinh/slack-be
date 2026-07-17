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
    const agentListText =
      agents.length > 0
        ? agents
            .map((a) => `- ${a.provider} (${a.label}): ${a.description}`)
            .join('\n')
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
      const { strategy, model } = this.llmFactory.resolve(
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

    // Tối ưu chi phí (xem accuracy.md, mục "chưa triển khai") — bước vừa xong
    // rõ ràng thành công (có dữ liệu thật, không phải lỗi/agent chưa khả dụng)
    // thì mặc định 'continue' bằng rule đơn giản, KHÔNG tốn 1 lượt gọi LLM.
    // Chỉ gọi LLM khi có tín hiệu đáng ngờ — nhất quán với nhánh lỗi bên dưới
    // (LLM lỗi cũng mặc định 'continue', MAX_SUPERVISOR_ROUNDS là lưới chặn cuối).
    if (this.looksClearlySuccessful(completedStep)) {
      return { verdict: 'continue' };
    }

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

  // Rule đơn giản, KHÔNG gọi LLM — chỉ coi là "rõ ràng thành công" khi có nội
  // dung THẬT (không rỗng) và không khớp 2 dấu hiệu lỗi/không khả dụng đã biết:
  // (1) describeExternalServiceError() luôn bắt đầu bằng "⚠️ Lỗi" (xem
  // external-service-error.util.ts), (2) TurnResolverService.continueRounds()
  // dùng đúng cụm "chưa khả dụng" khi agent không tồn tại/chưa kết nối. Bất kỳ
  // nội dung nào KHÁC 2 dấu hiệu này đều coi là thành công thật — nhất quán với
  // triết lý toàn hàm: khi không chắc thì cứ "continue", MAX_SUPERVISOR_ROUNDS
  // là lưới chặn cuối nếu có sai thì cũng không loop vô hạn.
  private looksClearlySuccessful(round: SupervisorRoundDto): boolean {
    const result = round.result?.trim();
    if (!result) return false;
    if (result.startsWith('⚠️ Lỗi')) return false;
    if (result.includes('chưa khả dụng')) return false;
    return true;
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
