import { Injectable, Logger } from '@nestjs/common';
import {
  ORCHESTRATION_CONSTANTS,
  SUPERVISOR_PLANNING_PROMPT,
  SUPERVISOR_EVALUATE_PROMPT,
  SUPERVISOR_EVALUATE_SCHEMA,
  SUPERVISOR_EVALUATE_SCHEMA_NO_DONE,
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
import { withLlmRetry } from './with-llm-retry.util';
import { CircuitBreakerService } from '../common/circuit-breaker.service';
import {
  capRoundResults,
  capToolResultSize,
  resolveDataCharBudget,
} from '../executor/tool-result-size-cap.util';
import { hasPendingActionStep } from '../common/pending-action-step.util';
import { MetricsRegistryService } from '../common/metrics-registry.service';
import { ChannelMemoryService } from '../memory/channel-memory.service';
import { ChannelMemoryEntity } from '../entity/channel-memory.entity';
import { detectFrustration } from './detect-frustration.util';

export interface AgentRankingCache {
  current?: { shown: AvailableAgentDto[]; omittedCount: number };
}

const MIN_AGENT_LABEL_LENGTH_FOR_RESCUE = 3;

// Ghi chú thiết kế đầy đủ (WHY): slack-docs/Documents/Orchestration/code-notes/supervisor.service.md
@Injectable()
export class SupervisorService {
  private readonly logger = new Logger(SupervisorService.name);

  constructor(
    private readonly mcpAuthClient: McpAuthClientService,
    private readonly llmFactory: LlmStrategyFactory,
    private readonly circuitBreaker: CircuitBreakerService,
    private readonly dynamicProviderDb: DynamicProviderDbService,
    private readonly embeddingProvider: OpenAiEmbeddingProvider,
    private readonly metrics: MetricsRegistryService,
    private readonly channelMemory: ChannelMemoryService,
  ) {}

  private getSystemAgents(): AvailableAgentDto[] {
    const provider = 'compute';
    if (!AGENT_REGISTRY[provider]?.endpoint) return [];
    return [
      {
        provider,
        label: AGENT_REGISTRY[provider].label,
        description: PROVIDER_DESCRIPTIONS[provider] ?? '',
      },
    ];
  }

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
        `Hệ thống/API mở rộng (Custom Swagger) tên "${entity.name}" — liên quan tới các thao tác/dữ liệu của hệ thống này (tham khảo: ${entity.specUrl}).`,
    }));

    return [...staticAgents, ...this.getSystemAgents(), ...dynamicAgents];
  }

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
      const clauses = this.splitPromptClauses(prompt);
      const rankedPerClause = await Promise.all(
        clauses.map((clause) =>
          index.search(clause, ORCHESTRATION_CONSTANTS.AGENT_RANKING_TOP_K),
        ),
      );
      const rankedByProvider = new Map<string, AvailableAgentDto>();
      for (const ranked of rankedPerClause) {
        for (const a of ranked) rankedByProvider.set(a.provider, a);
      }
      if (rankedByProvider.size === 0) {
        return { shown: agents, omittedCount: 0 };
      }
      const shown = this.rescueNamedAgents(prompt, agents, [
        ...rankedByProvider.values(),
      ]);
      return { shown, omittedCount: agents.length - shown.length };
    } catch (error) {
      this.logger.warn(
        `rankAgentsForPrompt() lỗi, fallback về liệt kê hết ${agents.length} agent: ${(error as Error).message}`,
      );
      return { shown: agents, omittedCount: 0 };
    }
  }

  private splitPromptClauses(prompt: string): string[] {
    const parts = prompt
      .split(/\brồi\b|\bsau đó\b|\bthen\b|\bafter that\b|;/gi)
      .map((p) => p.trim())
      .filter((p) => p.length > 0);
    const clauses = [...new Set([prompt, ...parts])];
    if (
      clauses.length > ORCHESTRATION_CONSTANTS.MAX_PROMPT_CLAUSES_FOR_RANKING
    ) {
      this.logger.warn(
        `splitPromptClauses() cắt ${clauses.length} mệnh đề còn ${ORCHESTRATION_CONSTANTS.MAX_PROMPT_CLAUSES_FOR_RANKING}`,
      );
      return clauses.slice(
        0,
        ORCHESTRATION_CONSTANTS.MAX_PROMPT_CLAUSES_FOR_RANKING,
      );
    }
    return clauses;
  }

  private rescueNamedAgents(
    prompt: string,
    agents: AvailableAgentDto[],
    shown: AvailableAgentDto[],
  ): AvailableAgentDto[] {
    const shownProviders = new Set(shown.map((a) => a.provider));
    const promptLower = prompt.toLowerCase();
    const rescued = agents.filter(
      (a) =>
        !shownProviders.has(a.provider) &&
        a.label.length >= MIN_AGENT_LABEL_LENGTH_FOR_RESCUE &&
        promptLower.includes(a.label.toLowerCase()),
    );
    if (rescued.length === 0) return shown;

    this.logger.log(
      `rescueNamedAgents() cứu ${rescued.length} agent bị ranking loại nhưng được nhắc rõ tên trong prompt gốc: ${rescued.map((a) => a.provider).join(',')}`,
    );
    return [...shown, ...rescued];
  }

  private findAmbiguousAgentCluster(
    prompt: string,
    agents: AvailableAgentDto[],
    chosenProvider: string,
  ): AvailableAgentDto[] | null {
    const chosen = agents.find((a) => a.provider === chosenProvider);
    if (!chosen) return null;

    const tokenize = (text: string) =>
      new Set(text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []);
    const chosenTokens = tokenize(chosen.description);
    const promptTokens = tokenize(prompt);
    const chosenLabelTokens = tokenize(chosen.label);

    const wordsMatch = (x: string, y: string) =>
      x === y || `${x}s` === y || `${y}s` === x;

    const similarOthers = agents.filter((a) => {
      if (a.provider === chosenProvider) return false;
      const otherTokens = tokenize(a.description);
      const intersectionSize = [...chosenTokens].filter((t) =>
        otherTokens.has(t),
      ).length;
      const unionSize = new Set([...chosenTokens, ...otherTokens]).size;
      const jaccard = unionSize === 0 ? 0 : intersectionSize / unionSize;
      if (jaccard < ORCHESTRATION_CONSTANTS.AMBIGUOUS_AGENT_JACCARD_THRESHOLD) {
        return false;
      }

      const otherLabelTokens = tokenize(a.label);
      const chosenOnlyWords = [...chosenLabelTokens].filter(
        (t) =>
          t.length >= MIN_AGENT_LABEL_LENGTH_FOR_RESCUE &&
          !otherLabelTokens.has(t),
      );
      const otherOnlyWords = [...otherLabelTokens].filter(
        (t) =>
          t.length >= MIN_AGENT_LABEL_LENGTH_FOR_RESCUE &&
          !chosenLabelTokens.has(t),
      );
      const namesWord = (words: string[]) =>
        words.some((w) => [...promptTokens].some((pt) => wordsMatch(pt, w)));
      if (namesWord(chosenOnlyWords) && !namesWord(otherOnlyWords)) {
        return false;
      }

      return true;
    });

    if (similarOthers.length === 0) return null;
    return [chosen, ...similarOthers];
  }

  async plan(
    prompt: string,
    agents: AvailableAgentDto[],
    rounds: SupervisorRoundDto[] = [],
    history: ChatHistoryTurnDto[] = [],
    rankingCache?: AgentRankingCache,
    signal?: AbortSignal,
    // ver3.md mục 1 (dài hạn) — optional, THÊM CUỐI CÙNG có chủ đích: giữ
    // nguyên tính tương thích vị trí (positional) của MỌI call site/test đã
    // có từ trước (rounds/history truyền theo vị trí thứ 3/4) — không dùng
    // channelId thì bỏ qua an toàn (memories = []).
    channelId?: string,
  ): Promise<SupervisorPlanDto> {
    const { shown, omittedCount } =
      rankingCache?.current ?? (await this.rankAgentsForPrompt(prompt, agents));
    if (rankingCache && !rankingCache.current) {
      rankingCache.current = { shown, omittedCount };
    }
    const agentListText =
      shown.length > 0
        ? shown
            .map((a) => `- ${a.provider} (${a.label}): ${a.description}`)
            .join('\n') +
          (omittedCount > 0
            ? `\n(Còn ${omittedCount} hệ thống khác đã kết nối nhưng không liên quan tới câu hỏi này, đã ẩn bớt khỏi danh sách trên.)`
            : '')
        : '(Người dùng chưa kết nối agent nào — nếu câu hỏi cần dữ liệu, trả lời "respond" và nhắc user vào Settings để kết nối.)';

    const planSchema =
      rounds.length > 0
        ? SUPERVISOR_PLAN_SCHEMA_NO_ANSWER
        : SUPERVISOR_PLAN_SCHEMA;

    try {
      const planModelId =
        process.env.SUPERVISOR_PLANNING_MODEL ??
        process.env.SUPERVISOR_MODEL ??
        ORCHESTRATION_CONSTANTS.SUPERVISOR_MODEL;
      const { strategy, model } = this.llmFactory.resolve(planModelId);
      const memories = channelId
        ? await this.channelMemory.getRecentMemories(channelId)
        : [];
      // ver3.md mục 5 — chỉ để harvest thủ công cho eval dataset sau này
      // (grep log theo tag), KHÔNG ảnh hưởng tới prompt (đã xử lý trong
      // buildPrompt() riêng).
      const frustrationPattern = detectFrustration(prompt);
      if (frustrationPattern) {
        this.logger.warn(
          `[frustration-signal] channelId=${channelId ?? 'unknown'} pattern="${frustrationPattern}"`,
        );
      }
      const fullPrompt = this.buildPrompt(
        prompt,
        rounds,
        history,
        memories,
        planModelId,
      );
      this.logger.log(
        `plan() model=${model} agents=${agents.length} historyTurns=${history.length} prompt=${fullPrompt}`,
      );
      const plan = await this.circuitBreaker.run(`llm:${strategy.id}`, () =>
        withLlmRetry(
          (attemptSignal) =>
            strategy.generateStructured<SupervisorPlanDto>({
              model,
              systemInstruction: `${SUPERVISOR_PLANNING_PROMPT}\n${agentListText}`,
              prompt: fullPrompt,
              schema: planSchema,
              signal: attemptSignal,
            }),
          ORCHESTRATION_CONSTANTS.LLM_CALL_TIMEOUT_MS,
          `Supervisor plan() timeout sau ${ORCHESTRATION_CONSTANTS.LLM_CALL_TIMEOUT_MS / 1000}s (model=${model})`,
          { signal },
        ),
      );
      this.logger.log(`plan() result=${JSON.stringify(plan)}`);
      if (plan.action === 'plan' && plan.steps?.[0]) {
        const cluster = this.findAmbiguousAgentCluster(
          prompt,
          shown,
          plan.steps[0].agent,
        );
        if (cluster) {
          this.logger.warn(
            `[ambiguous-agent-cluster] plan() chọn "${plan.steps[0].agent}" giữa ${cluster.length} agent mô tả tương tự nhau — candidates=${cluster.map((a) => a.provider).join(',')}`,
          );
          this.metrics.incrementBehaviorSignal('ambiguous_cluster');
          plan.ambiguousCandidates = cluster;
          return this.escalateIfAmbiguous(
            plan,
            fullPrompt,
            agentListText,
            planSchema,
            shown,
            prompt,
            signal,
          );
        }
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

  // ver3.md — model rẻ bị bias theo vị trí khi 2 agent mô tả giống nhau (đo
  // được qua eval-supervisor-plan.ts); model mạnh hơn không còn bias này. Chỉ
  // escalate ĐÚNG lúc cluster mơ hồ bị phát hiện (hiếm) — không tràn lan.
  // Off theo mặc định (SUPERVISOR_ESCALATION_MODEL không set = bỏ qua), để
  // không tự ý tốn thêm tiền khi chưa ai bật.
  private async escalateIfAmbiguous(
    plan: SupervisorPlanDto,
    fullPrompt: string,
    agentListText: string,
    schema: Record<string, unknown>,
    shown: AvailableAgentDto[],
    prompt: string,
    signal?: AbortSignal,
  ): Promise<SupervisorPlanDto> {
    const escalationModelId = process.env.SUPERVISOR_ESCALATION_MODEL;
    if (!escalationModelId) return plan;

    try {
      const { strategy, model } = this.llmFactory.resolve(escalationModelId);
      const escalated = await this.circuitBreaker.run(
        `llm:${strategy.id}`,
        () =>
          withLlmRetry(
            (attemptSignal) =>
              strategy.generateStructured<SupervisorPlanDto>({
                model,
                systemInstruction: `${SUPERVISOR_PLANNING_PROMPT}\n${agentListText}`,
                prompt: fullPrompt,
                schema,
                signal: attemptSignal,
              }),
            ORCHESTRATION_CONSTANTS.LLM_CALL_TIMEOUT_MS,
            `Supervisor plan() escalation timeout sau ${ORCHESTRATION_CONSTANTS.LLM_CALL_TIMEOUT_MS / 1000}s (model=${model})`,
            { signal },
          ),
      );
      this.metrics.incrementBehaviorSignal('model_escalation');
      this.logger.log(
        `plan() escalated to ${model} do cluster mơ hồ — result=${JSON.stringify(escalated)}`,
      );
      if (escalated.action === 'plan' && escalated.steps?.[0]) {
        escalated.ambiguousCandidates =
          this.findAmbiguousAgentCluster(
            prompt,
            shown,
            escalated.steps[0].agent,
          ) ?? undefined;
      }
      return escalated;
    } catch (error) {
      this.logger.warn(
        `plan() escalation thất bại, giữ nguyên kết quả gốc: ${(error as Error).message}`,
      );
      return plan;
    }
  }

  async evaluate(
    originalPrompt: string,
    completedStep: SupervisorRoundDto,
    remainingSteps: DelegationDto[],
    signal?: AbortSignal,
  ): Promise<SupervisorEvaluateDto> {
    if (remainingSteps.length === 0) {
      return { verdict: 'done' };
    }

    const evaluateModelId =
      process.env.SUPERVISOR_EVALUATE_MODEL ??
      process.env.SUPERVISOR_MODEL ??
      ORCHESTRATION_CONSTANTS.SUPERVISOR_MODEL;
    const cappedResult = capToolResultSize(
      completedStep.result,
      resolveDataCharBudget(evaluateModelId),
    );
    const remainingText = remainingSteps
      .map((s, i) => {
        const marker =
          s.mustExecute === true
            ? ' [BẮT BUỘC — không được bỏ qua]'
            : s.mustExecute === false
              ? ' [không bắt buộc — có thể bỏ qua nếu đã đủ dữ liệu]'
              : '';
        return `${i + 1}. Agent "${s.agent}": ${s.task}${marker}`;
      })
      .join('\n');
    const mustFinishRemaining = hasPendingActionStep(remainingSteps);
    const doneNotAllowedNote = mustFinishRemaining
      ? '\n\nLƯU Ý: còn ít nhất 1 bước BẮT BUỘC (đánh dấu ở trên) chưa chạy — "done" không phải lựa chọn hợp lệ ở lượt này, chỉ được chọn "continue" hoặc "re-plan".'
      : '';
    const prompt = `Câu hỏi gốc: ${originalPrompt}\n\nBước vừa thực hiện xong — Agent "${completedStep.agent}" (yêu cầu: "${completedStep.task}") → kết quả: ${cappedResult}\n\nCác bước CÒN LẠI trong kế hoạch (chưa chạy):\n${remainingText}\n\nBước vừa xong có đạt kỳ vọng không, các bước còn lại có còn hợp lý để tiếp tục không?${doneNotAllowedNote}`;

    try {
      const { strategy, model } = this.llmFactory.resolve(evaluateModelId);
      const verdict = await this.circuitBreaker.run(`llm:${strategy.id}`, () =>
        withLlmRetry(
          (attemptSignal) =>
            strategy.generateStructured<SupervisorEvaluateDto>({
              model,
              systemInstruction: SUPERVISOR_EVALUATE_PROMPT,
              prompt,
              schema: mustFinishRemaining
                ? SUPERVISOR_EVALUATE_SCHEMA_NO_DONE
                : SUPERVISOR_EVALUATE_SCHEMA,
              signal: attemptSignal,
            }),
          ORCHESTRATION_CONSTANTS.LLM_CALL_TIMEOUT_MS,
          `Supervisor evaluate() timeout sau ${ORCHESTRATION_CONSTANTS.LLM_CALL_TIMEOUT_MS / 1000}s (model=${model})`,
          { signal },
        ),
      );
      this.logger.log(`evaluate() result=${JSON.stringify(verdict)}`);
      return verdict;
    } catch (error) {
      this.logger.error(
        `Supervisor evaluate() failed: ${(error as Error).message}`,
        (error as Error).stack,
      );
      return { verdict: 'continue' };
    }
  }

  async synthesize(
    originalPrompt: string,
    rounds: SupervisorRoundDto[],
    onToken?: (chunk: string) => void,
    signal?: AbortSignal,
  ): Promise<string> {
    try {
      const modelId =
        process.env.SUPERVISOR_MODEL ??
        ORCHESTRATION_CONSTANTS.SUPERVISOR_MODEL;
      const { strategy, model } = this.llmFactory.resolve(modelId);

      const roundsText = capRoundResults(rounds, resolveDataCharBudget(modelId))
        .map(
          (r, i) =>
            `${i + 1}. Agent "${r.agent}" (yêu cầu: "${r.task}") → kết quả: ${r.result}`,
        )
        .join('\n');

      const session = strategy.startChat({
        model,
        systemInstruction: SUPERVISOR_SYNTHESIS_PROMPT,
        tools: [],
        history: [],
      });

      const prompt = `Câu hỏi gốc: ${originalPrompt}\n\nDữ liệu đã thu thập được:\n${roundsText}\n\nHãy tổng hợp các dữ liệu trên thành một câu trả lời hoàn chỉnh cho người dùng.`;

      // streamedAnything reset lại MỖI lần thử (đầu fn()) — chỉ cho retry khi
      // lần vừa lỗi CHƯA stream ra token nào (xem ORCHESTRATION_CONSTANTS.MAX_LLM_CALL_RETRY_ATTEMPTS).
      let streamedAnything = false;
      const trackedOnToken = onToken
        ? (chunk: string) => {
            streamedAnything = true;
            onToken(chunk);
          }
        : undefined;
      const result = await this.circuitBreaker.run(`llm:${strategy.id}`, () =>
        withLlmRetry(
          (attemptSignal) => {
            streamedAnything = false;
            return session.sendMessage(prompt, trackedOnToken, attemptSignal);
          },
          ORCHESTRATION_CONSTANTS.LLM_CALL_TIMEOUT_MS,
          `Supervisor synthesize() timeout sau ${ORCHESTRATION_CONSTANTS.LLM_CALL_TIMEOUT_MS / 1000}s (model=${model})`,
          { signal, canRetry: () => !streamedAnything },
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

  /** Gộp channel_memory (nếu có) + lịch sử hội thoại (nếu có) + prompt gốc + các vòng delegate đã chạy (nếu có) thành 1 prompt duy nhất. */
  private buildPrompt(
    originalPrompt: string,
    previousRounds: SupervisorRoundDto[],
    history: ChatHistoryTurnDto[],
    memories: ChannelMemoryEntity[],
    modelId: string,
  ): string {
    const sections: string[] = [];

    // ver3.md mục 5 — đứng ĐẦU TIÊN (trước cả channel_memory), vì đây là tín
    // hiệu khẩn của CHÍNH lượt đang xử lý, không phải thông tin nền.
    const frustrationPattern = detectFrustration(originalPrompt);
    if (frustrationPattern) {
      sections.push(
        `⚠️ Tin nhắn hiện tại của user có dấu hiệu không hài lòng/bực bội (khớp mẫu: "${frustrationPattern}"). Xem kỹ "Các bước đã thực hiện trong turn này" hoặc lịch sử gần nhất trước khi lặp lại đúng thao tác cũ — cân nhắc cách tiếp cận khác, hoặc hỏi lại rõ hơn nếu chưa chắc chắn tại sao lần trước chưa đạt.`,
      );
    }

    // ver3.md mục 1 (dài hạn) — đứng TRƯỚC lịch sử hội thoại, framing rõ là
    // GỢI Ý tham khảo, không phải cam kết tuyệt đối (thực thể vẫn có thể bị
    // đổi/xoá bởi người khác sau đó).
    if (memories.length > 0) {
      const memoryText = memories.map((m) => `- ${m.content}`).join('\n');
      sections.push(
        `Thông tin đã xác nhận trước đó trong channel này (GỢI Ý tham khảo, KHÔNG phải cam kết tuyệt đối — nếu cần chắc chắn cho 1 hành động quan trọng, hãy kiểm tra lại bằng tool trước khi dùng làm căn cứ; thực thể này vẫn có thể đã bị đổi/xoá bởi người khác sau đó):\n${memoryText}`,
      );
    }

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
      const roundsText = capRoundResults(
        previousRounds,
        resolveDataCharBudget(modelId),
      )
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
