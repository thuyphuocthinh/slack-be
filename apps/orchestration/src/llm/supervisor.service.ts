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
  ESupervisorVerdict,
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
import { ToolCallTraceDto } from '../dto/react-loop.dto';
import { LlmStrategyFactory } from './strategy/llm-strategy.factory';
import { checkQuantity, QuantityCheckResult } from './quantity-check.util';
import { describeExternalServiceError } from './external-service-error.util';
import { withLlmRetry } from './with-llm-retry.util';
import { CircuitBreakerService } from '../common/circuit-breaker.service';
import {
  capRoundResults,
  capToolResultSize,
} from '../executor/tool-result-size-cap.util';
import { hasPendingActionStep } from '../common/pending-action-step.util';
import { MetricsRegistryService } from '../common/metrics-registry.service';
import { MemoryManagerService } from '../memory/memory-manager.service';
import { SkillRetrievalService } from '../memory/skill-retrieval.service';
import { AgentRankingService } from './agent-ranking.service';
import { SupervisorPromptBuilder } from './supervisor-prompt.builder';
import { detectFrustration } from './detect-frustration.util';
import { EdgeRelayRegistryService } from '../edge-relay/edge-relay-registry.service';

export interface AgentRankingCache {
  current?: { shown: AvailableAgentDto[]; omittedCount: number };
}

// Ghi chú thiết kế đầy đủ (WHY): slack-docs/Documents/Orchestration/code-notes/supervisor.service.md
@Injectable()
export class SupervisorService {
  private readonly logger = new Logger(SupervisorService.name);

  constructor(
    private readonly mcpAuthClient: McpAuthClientService,
    private readonly llmFactory: LlmStrategyFactory,
    private readonly circuitBreaker: CircuitBreakerService,
    private readonly dynamicProviderDb: DynamicProviderDbService,
    private readonly metrics: MetricsRegistryService,
    private readonly memoryManager: MemoryManagerService,
    private readonly skillRetrieval: SkillRetrievalService,
    private readonly agentRanking: AgentRankingService,
    private readonly promptBuilder: SupervisorPromptBuilder,
    private readonly edgeRelayRegistry: EdgeRelayRegistryService,
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

  async getAvailableAgents(
    userId: string,
    workspaceId?: string,
  ): Promise<AvailableAgentDto[]> {
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

    return [
      ...staticAgents,
      ...this.getRelayBoundAgents(workspaceId, staticAgents),
      ...this.getSystemAgents(),
      ...dynamicAgents,
    ];
  }

  // Provider có AgentRegistryEntry.perWorkspaceInstance (relay on-prem riêng
  // của workspace) KHÔNG đi qua mcp_auth is_connected/endpoint tĩnh ở trên,
  // nên bị lọc mất khỏi staticAgents nếu không OR-in ở đây.
  private getRelayBoundAgents(
    workspaceId: string | undefined,
    alreadyIncluded: AvailableAgentDto[],
  ): AvailableAgentDto[] {
    if (!workspaceId) return [];

    const alreadyIncludedProviders = new Set(
      alreadyIncluded.map((agent) => agent.provider),
    );

    return Object.entries(AGENT_REGISTRY)
      .filter(
        ([provider, entry]) =>
          entry.perWorkspaceInstance &&
          !alreadyIncludedProviders.has(provider) &&
          this.edgeRelayRegistry.isOnline(workspaceId),
      )
      .map(([provider, entry]) => ({
        provider,
        label: entry.label,
        description: PROVIDER_DESCRIPTIONS[provider] ?? '',
      }));
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
    // Cùng lý do trên — thêm cuối cùng. Skill scope theo workspace (không
    // theo channel như channel_memory), không truyền thì bỏ qua an toàn.
    workspaceId?: string,
  ): Promise<SupervisorPlanDto> {
    const { shown, omittedCount } =
      rankingCache?.current ??
      (await this.agentRanking.rankAgentsForPrompt(prompt, agents));
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
        ? await this.memoryManager.getMemories(channelId, planModelId, prompt)
        : [];
      const matchedSkill = workspaceId
        ? await this.skillRetrieval.findMatching(prompt, workspaceId)
        : null;
      // ver3.md mục 5 — chỉ để harvest thủ công cho eval dataset sau này
      // (grep log theo tag), KHÔNG ảnh hưởng tới prompt (đã xử lý trong
      // buildPrompt() riêng).
      const frustrationPattern = detectFrustration(prompt);
      if (frustrationPattern) {
        this.logger.warn(
          `[frustration-signal] channelId=${channelId ?? 'unknown'} pattern="${frustrationPattern}"`,
        );
      }
      const fullPrompt = this.promptBuilder.build(
        prompt,
        rounds,
        history,
        memories,
        planModelId,
        matchedSkill,
      );
      this.logger.log(
        `plan() model=${model} agents=${agents.length} historyTurns=${history.length} prompt=${fullPrompt}`,
      );
      const plan = await this.circuitBreaker.run(
        `llm:${strategy.id}`,
        () =>
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
        signal,
      );
      this.logger.log(`plan() result=${JSON.stringify(plan)}`);
      if (plan.action === 'plan' && plan.steps?.[0]) {
        const cluster = this.agentRanking.findAmbiguousAgentCluster(
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
      if (signal?.aborted) {
        throw error;
      }
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
        signal,
      );
      this.metrics.incrementBehaviorSignal('model_escalation');
      this.logger.log(
        `plan() escalated to ${model} do cluster mơ hồ — result=${JSON.stringify(escalated)}`,
      );
      if (escalated.action === 'plan' && escalated.steps?.[0]) {
        escalated.ambiguousCandidates =
          this.agentRanking.findAmbiguousAgentCluster(
            prompt,
            shown,
            escalated.steps[0].agent,
          ) ?? undefined;
      }
      return escalated;
    } catch (error) {
      if (signal?.aborted) {
        throw error;
      }
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
      return { verdict: ESupervisorVerdict.DONE };
    }

    const evaluateModelId =
      process.env.SUPERVISOR_EVALUATE_MODEL ??
      process.env.SUPERVISOR_MODEL ??
      ORCHESTRATION_CONSTANTS.SUPERVISOR_MODEL;
    const cappedResult = capToolResultSize(
      completedStep.result,
      this.memoryManager.buildBudget(evaluateModelId).toolResultCharBudget,
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
      ? '\n\nLƯU Ý: còn ít nhất 1 bước BẮT BUỘC (đánh dấu ở trên) chưa chạy — "done" không phải lựa chọn hợp lệ ở lượt này, chỉ được chọn "continue" hoặc "replan".'
      : '';
    const prompt = `Câu hỏi gốc: ${originalPrompt}\n\nBước vừa thực hiện xong — Agent "${completedStep.agent}" (yêu cầu: "${completedStep.task}") → kết quả: ${cappedResult}\n\nCác bước CÒN LẠI trong kế hoạch (chưa chạy):\n${remainingText}\n\nBước vừa xong có đạt kỳ vọng không, các bước còn lại có còn hợp lý để tiếp tục không?${doneNotAllowedNote}`;

    try {
      const { strategy, model } = this.llmFactory.resolve(evaluateModelId);
      const verdict = await this.circuitBreaker.run(
        `llm:${strategy.id}`,
        () =>
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
        signal,
      );
      this.logger.log(`evaluate() result=${JSON.stringify(verdict)}`);
      return verdict;
    } catch (error) {
      if (signal?.aborted) {
        throw error;
      }
      this.logger.error(
        `Supervisor evaluate() failed: ${(error as Error).message}`,
        (error as Error).stack,
      );
      return { verdict: ESupervisorVerdict.CONTINUE };
    }
  }

  // HH1 (manual_test_bank_heavy.md) — checkQuantity() ở react-loop-run.ts chỉ
  // so cục bộ TRONG 1 ReactLoopService.run(); khi Supervisor tự lặp/tách
  // nhiều step cho CÙNG 1 yêu cầu số lượng (VD 12 sản phẩm), mỗi step tự thấy
  // đủ dù TỔNG cả turn đã vượt/thiếu — synthesize() vẫn có thể báo sai số. Gọi
  // SAU CÙNG (finalizeAnswer()), gộp resultPreview của TOÀN BỘ toolCalls turn.
  async checkCumulativeQuantity(
    originalPrompt: string,
    toolCalls: ToolCallTraceDto[],
    signal?: AbortSignal,
  ): Promise<QuantityCheckResult> {
    const resultsText = toolCalls
      .filter((tc) => tc.status === 'success' && tc.resultPreview)
      .map((tc) => `${tc.tool}: ${tc.resultPreview}`)
      .join('\n');
    if (!resultsText) {
      return { requiredCount: 0, achievedCount: 0 };
    }

    const modelId =
      process.env.SUPERVISOR_EVALUATE_MODEL ??
      process.env.SUPERVISOR_MODEL ??
      ORCHESTRATION_CONSTANTS.SUPERVISOR_MODEL;
    const { strategy, model } = this.llmFactory.resolve(modelId);
    return checkQuantity(
      originalPrompt,
      resultsText,
      strategy,
      model,
      this.circuitBreaker,
      this.logger,
      signal,
    );
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

      const roundsText = capRoundResults(
        rounds,
        this.memoryManager.buildBudget(modelId).toolResultCharBudget,
      )
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
      const result = await this.circuitBreaker.run(
        `llm:${strategy.id}`,
        () =>
          withLlmRetry(
            (attemptSignal) => {
              streamedAnything = false;
              return session.sendMessage(prompt, trackedOnToken, attemptSignal);
            },
            ORCHESTRATION_CONSTANTS.LLM_CALL_TIMEOUT_MS,
            `Supervisor synthesize() timeout sau ${ORCHESTRATION_CONSTANTS.LLM_CALL_TIMEOUT_MS / 1000}s (model=${model})`,
            { signal, canRetry: () => !streamedAnything },
          ),
        signal,
      );
      this.logger.log(`synthesize() result=${result.text}`);
      return result.text;
    } catch (error) {
      // Bị Stop giữa chừng — đẩy lên cho runCancellable() hiện "Đã dừng theo
      // yêu cầu", không log ERROR/trả fallback answer như lỗi provider thật.
      if (signal?.aborted) {
        throw error;
      }
      this.logger.error(
        `Supervisor synthesize() failed: ${(error as Error).message}`,
        (error as Error).stack,
      );
      return describeExternalServiceError(error);
    }
  }
}
