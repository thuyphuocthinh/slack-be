import { Logger } from '@nestjs/common';
import { IProcessAiTriggerJobData } from '@slack/queue';
import { ORCHESTRATION_CONSTANTS, ESupervisorVerdict } from '@slack/constants';
import { ReactLoopService } from '../llm/react-loop.service';
import { ToolRepeatGuard } from '../llm/tool-repeat-guard';
import {
  AgentRankingCache,
  SupervisorService,
} from '../llm/supervisor.service';
import { AgentStreamService } from '../socket/agent-stream.service';
import {
  AvailableAgentDto,
  DelegationDto,
  SupervisorRoundDto,
} from '../dto/supervisor.dto';
import { ToolCallTraceDto } from '../dto/react-loop.dto';
import { ChatHistoryTurnDto } from '../dto/message-client.dto';
import { ApprovalRequiredError } from '../llm/approval-required.error';
import { AgentCancellationService } from '../cancellation/agent-cancellation.service';
import { runCancellable } from '../common/cancellable-run.util';
import { TurnCancelledError } from '../llm/turn-cancelled.error';
import { describeExternalServiceError } from '../llm/external-service-error.util';
import { CheckpointPauseService } from './checkpoint-pause.service';
import { MetricsRegistryService } from '../common/metrics-registry.service';
import { buildOnToken } from './agent-stream-token.util';
import { capRoundResultsWeighted } from '../executor/tool-result-size-cap.util';
import { MemoryManagerService } from '../memory/memory-manager.service';
import { hasPendingActionStep } from '../common/pending-action-step.util';
import {
  AnswerResult,
  ApprovalRequiredDelegateResult,
  DelegateRoundResult,
  buildAnswer,
} from './orchestration-answer.types';

const MIN_AGENT_LABEL_LENGTH_FOR_MISMATCH_CHECK = 3;

const GUARDRAIL_BLOCKED_MARKER = 'Bỏ qua bước này';
const REPLAN_MARKER = '[re-plan]';

function isNonProgressRound(round: SupervisorRoundDto): boolean {
  return (
    round.result.startsWith(GUARDRAIL_BLOCKED_MARKER) ||
    round.result.startsWith(REPLAN_MARKER)
  );
}
function buildCancelledPartialText(
  rounds: SupervisorRoundDto[],
  inProgressPartialText?: string,
): string | undefined {
  const doneRounds = rounds.filter((r) => !isNonProgressRound(r));
  const doneParts =
    doneRounds.length === 1
      ? [doneRounds[0].result]
      : doneRounds.map((r, i) => `${i + 1}. ${r.agent}: ${r.result}`);
  if (!inProgressPartialText) {
    return doneParts.length > 0 ? doneParts.join('\n\n') : undefined;
  }
  // Không có round nào TRƯỚC — không cần tiền tố phân biệt, trả nguyên văn.
  if (doneParts.length === 0) return inProgressPartialText;
  return [
    ...doneParts,
    `(đang xử lý dở khi bị dừng) ${inProgressPartialText}`,
  ].join('\n\n');
}

export interface TurnResolverRunOptions {
  data: IProcessAiTriggerJobData;
  replyMessageId: string;
  prompt: string;
  agents: AvailableAgentDto[];
  history: ChatHistoryTurnDto[];
  rounds: SupervisorRoundDto[];
  toolCalls: ToolCallTraceDto[];
  signal?: AbortSignal;
}

export interface TurnResolverRunDeps {
  reactLoop: ReactLoopService;
  supervisor: SupervisorService;
  agentStream: AgentStreamService;
  cancellation: AgentCancellationService;
  checkpointPause: CheckpointPauseService;
  metrics: MetricsRegistryService;
  memoryManager: MemoryManagerService;
  logger: Logger;
}

type PlanOutcome =
  | { done: true; answer: AnswerResult }
  | { done: false; steps: DelegationDto[] };

type EvaluateOutcome = ESupervisorVerdict;

/**
 * State + logic của 1 lượt "Plan → delegate → evaluate → synthesize" (1 turn
 * user). Tách khỏi TurnResolverService để state (rounds/toolCalls/counters)
 * là field thay vì phải truyền qua hàng loạt tham số — cùng lý do đã tách
 * ReactLoopRun khỏi ReactLoopService. Xem thiết kế đầy đủ (WHY):
 * slack-docs/Documents/Orchestration/code-notes/turn-resolver.service.md
 */
export class TurnResolverRun {
  private readonly data: IProcessAiTriggerJobData;
  private readonly replyMessageId: string;
  private readonly prompt: string;
  private readonly agents: AvailableAgentDto[];
  private readonly history: ChatHistoryTurnDto[];
  private readonly rounds: SupervisorRoundDto[];
  private readonly toolCalls: ToolCallTraceDto[];
  private readonly signal?: AbortSignal;

  private readonly repeatGuard = new ToolRepeatGuard();

  private readonly reactLoop: ReactLoopService;
  private readonly supervisor: SupervisorService;
  private readonly agentStream: AgentStreamService;
  private readonly cancellation: AgentCancellationService;
  private readonly checkpointPause: CheckpointPauseService;
  private readonly metrics: MetricsRegistryService;
  private readonly memoryManager: MemoryManagerService;
  private readonly logger: Logger;

  private nonProgressRounds: number;
  private realStepsRun: number;

  constructor(options: TurnResolverRunOptions, deps: TurnResolverRunDeps) {
    this.data = options.data;
    this.replyMessageId = options.replyMessageId;
    this.prompt = options.prompt;
    this.agents = options.agents;
    this.history = options.history;
    this.rounds = options.rounds;
    this.toolCalls = options.toolCalls;
    this.signal = options.signal;

    this.reactLoop = deps.reactLoop;
    this.supervisor = deps.supervisor;
    this.agentStream = deps.agentStream;
    this.cancellation = deps.cancellation;
    this.checkpointPause = deps.checkpointPause;
    this.metrics = deps.metrics;
    this.memoryManager = deps.memoryManager;
    this.logger = deps.logger;

    this.nonProgressRounds = this.rounds.filter(isNonProgressRound).length;
    this.realStepsRun = this.rounds.length - this.nonProgressRounds;
  }

  async run(
    forcedStep?: DelegationDto,
    remainingSteps?: DelegationDto[],
  ): Promise<AnswerResult> {
    let steps: DelegationDto[] = forcedStep
      ? [forcedStep, ...(remainingSteps ?? [])]
      : (remainingSteps ?? []);
    let needsPlan = !forcedStep && remainingSteps === undefined;
    const agentRankingCache: AgentRankingCache = {};

    if (!forcedStep && remainingSteps !== undefined && this.rounds.length > 0) {
      const resumeOutcome = await this.handleResumeEvaluation(steps);
      if (resumeOutcome.done) return resumeOutcome.answer;
      steps = resumeOutcome.steps;
      needsPlan = resumeOutcome.needsPlan;
    }

    while (
      this.realStepsRun < ORCHESTRATION_CONSTANTS.MAX_REAL_STEPS_PER_TURN &&
      this.nonProgressRounds < ORCHESTRATION_CONSTANTS.MAX_SUPERVISOR_ROUNDS
    ) {
      await this.throwIfCancelled();

      if (needsPlan) {
        const planOutcome = await this.runPlanningStep(agentRankingCache);
        if (planOutcome.done) return planOutcome.answer;
        steps = planOutcome.steps;
        needsPlan = false;
      }

      if (steps.length === 0) {
        return this.finalizeAnswer();
      }

      const step = steps.shift()!;

      if (this.guardAgainstMisroute(step)) {
        needsPlan = true;
        steps = [];
        continue;
      }

      const stepOutcome = await this.runDelegationStep(step, steps);
      if (stepOutcome.done) return stepOutcome.answer;
      if (stepOutcome.replan) {
        needsPlan = true;
        steps = [];
      }
    }

    return this.runNonConvergenceFallback();
  }

  private async throwIfCancelled(): Promise<void> {
    if (
      this.signal?.aborted ||
      (await this.cancellation.isCancelled(this.replyMessageId))
    ) {
      throw new TurnCancelledError(buildCancelledPartialText(this.rounds));
    }
  }

  /** Resume sau khi duyệt 1 hành động — evaluate() lại bước VỪA xong trước
   * khi tiếp tục, y hệt như nếu turn chưa từng dừng lại chờ duyệt. */
  private async handleResumeEvaluation(
    steps: DelegationDto[],
  ): Promise<
    | { done: true; answer: AnswerResult }
    | { done: false; steps: DelegationDto[]; needsPlan: boolean }
  > {
    const lastRound = this.rounds[this.rounds.length - 1];
    const outcome = await this.runEvaluateAndDecide(lastRound, steps);
    if (outcome === 'finalize') {
      return { done: true, answer: await this.finalizeAnswer() };
    }
    if (outcome === 'replan') {
      this.nonProgressRounds++;
      this.metrics.incrementBehaviorSignal('replan');
      this.rounds.push({
        agent: lastRound.agent,
        task: lastRound.task,
        result: `${REPLAN_MARKER} evaluate() cho rằng bước vừa xong không đạt kỳ vọng, đã lập lại kế hoạch.`,
      });
      return { done: false, steps: [], needsPlan: true };
    }
    return { done: false, steps, needsPlan: false };
  }

  private async runPlanningStep(
    agentRankingCache: AgentRankingCache,
  ): Promise<PlanOutcome> {
    const plan = await this.supervisor.plan(
      this.prompt,
      this.agents,
      this.rounds,
      this.history,
      agentRankingCache,
      this.signal,
      this.data.channelId,
      this.data.workspaceId,
    );

    if (plan.action === 'respond') {
      if (plan.rememberFact) {
        this.memoryManager
          .recordUserDeclaredFact(
            this.data.channelId,
            this.replyMessageId,
            plan.rememberFact,
          )
          .catch((error) =>
            this.logger.warn(
              `recordUserDeclaredFact() failed: ${(error as Error).message}`,
            ),
          );
      }
      const answerHint =
        plan.answer ||
        (plan.rememberFact
          ? `Mình đã ghi nhớ: ${plan.rememberFact}.`
          : plan.answer);
      return { done: true, answer: await this.finalizeAnswer(answerHint) };
    }

    const steps = plan.steps ?? [];

    steps.forEach((s) => {
      const safeAgent = s.agent || '';
      const matchedAgent = this.agents.find(
        (a) =>
          a.provider === safeAgent ||
          a.label.toLowerCase() === safeAgent.toLowerCase() ||
          a.label.toLowerCase().replace(/[^a-z0-9]/g, '') ===
            safeAgent.toLowerCase().replace(/[^a-z0-9]/g, ''),
      );
      if (matchedAgent && matchedAgent.provider !== s.agent) {
        s.agent = matchedAgent.provider;
      }
    });

    if (steps.every((s) => !this.agents.some((a) => a.provider === s.agent))) {
      const attemptedAgents = steps.map((s) => s.agent || 'unknown').join(', ');
      return {
        done: true,
        answer: buildAnswer(
          plan.answer ||
            `Mình chưa thể xử lý yêu cầu này với các kết nối hiện có (Tên hệ thống mà AI đang cố gọi: "${attemptedAgents}" - Vui lòng đổi tên hoặc viết đúng tên). Vào Settings để kết nối agent phù hợp nhé.`,
          this.toolCalls,
        ),
      };
    }
    if (
      process.env.ENABLE_CLARIFICATION_HITL === 'true' &&
      plan.ambiguousCandidates?.some((c) => c.provider === steps[0]?.agent)
    ) {
      this.metrics.incrementBehaviorSignal('clarification_required');
      return {
        done: true,
        answer: await this.checkpointPause.pauseForClarification(
          this.data,
          this.prompt,
          this.rounds,
          this.toolCalls,
          this.history,
          steps[0].task,
          plan.ambiguousCandidates,
          steps.slice(1),
        ),
      };
    }

    return { done: false, steps };
  }

  /** true nghĩa là ĐÃ push round guardrail + cần re-plan — gọi nơi gọi tự
   * reset steps/needsPlan rồi continue vòng lặp. */
  private guardAgainstMisroute(step: DelegationDto): boolean {
    const misroutedTo = this.findLikelyMisroutedAgent(step);
    if (!misroutedTo) return false;

    this.logger.warn(
      `Guardrail: bước chọn agent "${step.agent}" nhưng task nhắc rõ hệ thống "${misroutedTo.label}" (provider "${misroutedTo.provider}") — nghi ngờ chọn sai, re-plan sớm thay vì thực thi mù.`,
    );
    this.rounds.push({
      agent: step.agent,
      task: step.task,
      result: `${GUARDRAIL_BLOCKED_MARKER} — kế hoạch chọn hệ thống "${step.agent}" nhưng yêu cầu nhắc rõ tới hệ thống "${misroutedTo.label}" (đã kết nối, provider "${misroutedTo.provider}") — có khả năng chọn sai agent, cần lập lại kế hoạch.`,
    });
    this.nonProgressRounds++;
    this.metrics.incrementBehaviorSignal('misroute_guardrail');
    return true;
  }

  private async runDelegationStep(
    step: DelegationDto,
    remainingSteps: DelegationDto[],
  ): Promise<
    { done: true; answer: AnswerResult } | { done: false; replan: boolean }
  > {
    const result = await this.delegateRound(step, this.realStepsRun);
    this.realStepsRun++;

    if (result && 'approvalRequired' in result) {
      this.toolCalls.push(...result.toolCalls);
      const preApprovalRound = this.buildPreApprovalRound(
        step,
        result.toolCalls,
      );
      if (preApprovalRound) this.rounds.push(preApprovalRound);
      this.metrics.incrementBehaviorSignal('approval_required');
      return {
        done: true,
        answer: await this.checkpointPause.pauseForApproval(
          this.data,
          this.prompt,
          this.rounds,
          this.toolCalls,
          this.history,
          result,
          remainingSteps,
        ),
      };
    }

    const completedRound: SupervisorRoundDto = result
      ? result.round
      : {
          agent: step.agent,
          task: step.task,
          result:
            'Agent này chưa khả dụng (chưa kết nối hoặc chưa có hạ tầng) — bỏ qua, không thực hiện được phần việc này.',
        };
    this.rounds.push(completedRound);
    if (result) this.toolCalls.push(...result.toolCalls);

    const outcome = await this.runEvaluateAndDecide(
      completedRound,
      remainingSteps,
    );
    if (outcome === 'finalize') {
      return { done: true, answer: await this.finalizeAnswer() };
    }
    if (outcome === 'replan') {
      this.nonProgressRounds++;
      this.metrics.incrementBehaviorSignal('replan');
      this.rounds.push({
        agent: completedRound.agent,
        task: completedRound.task,
        result: `${REPLAN_MARKER} evaluate() cho rằng bước vừa xong không đạt kỳ vọng, đã lập lại kế hoạch.`,
      });
      return { done: false, replan: true };
    }
    return { done: false, replan: false };
  }

  private async runNonConvergenceFallback(): Promise<AnswerResult> {
    const { userId, channelId, channelType } = this.data;
    this.logger.warn(
      `Supervisor chưa hội tụ (realSteps=${this.realStepsRun}/${ORCHESTRATION_CONSTANTS.MAX_REAL_STEPS_PER_TURN}, nonProgress=${this.nonProgressRounds}/${ORCHESTRATION_CONSTANTS.MAX_SUPERVISOR_ROUNDS}) cho user ${userId}, tổng hợp lại kết quả đã có`,
    );
    this.metrics.incrementBehaviorSignal('non_convergence');
    await this.agentStream
      .emitStep(
        { userId, channelId, messageId: this.replyMessageId, channelType },
        {
          type: 'step_start',
          label: 'Tổng hợp câu trả lời',
          kind: 'synthesize',
        },
      )
      .catch(() => {});
    const fallbackAccumulator = { text: '' };
    const finalAnswer = await runCancellable(
      this.replyMessageId,
      this.cancellation,
      (sig) =>
        this.supervisor.synthesize(
          this.prompt,
          this.rounds,
          buildOnToken(
            this.agentStream,
            userId,
            channelId,
            this.replyMessageId,
            channelType,
            fallbackAccumulator,
          ),
          sig,
        ),
      () =>
        new TurnCancelledError(
          buildCancelledPartialText(this.rounds, fallbackAccumulator.text),
        ),
      this.signal,
    );
    return buildAnswer(
      await this.appendCumulativeQuantityDisclaimer(finalAnswer),
      this.toolCalls,
    );
  }

  private async finalizeAnswer(answerHint?: string): Promise<AnswerResult> {
    const { userId, channelId, channelType } = this.data;

    if (this.rounds.length === 1) {
      return buildAnswer(
        await this.appendCumulativeQuantityDisclaimer(this.rounds[0].result),
        this.toolCalls,
      );
    }
    if (this.rounds.length > 1) {
      await this.agentStream
        .emitStep(
          { userId, channelId, messageId: this.replyMessageId, channelType },
          {
            type: 'step_start',
            label: 'Tổng hợp câu trả lời',
            kind: 'synthesize',
          },
        )
        .catch(() => {});
      const accumulator = { text: '' };
      const finalAnswer = await runCancellable(
        this.replyMessageId,
        this.cancellation,
        (sig) =>
          this.supervisor.synthesize(
            this.prompt,
            this.rounds,
            buildOnToken(
              this.agentStream,
              userId,
              channelId,
              this.replyMessageId,
              channelType,
              accumulator,
            ),
            sig,
          ),
        () =>
          new TurnCancelledError(
            buildCancelledPartialText(this.rounds, accumulator.text),
          ),
        this.signal,
      );
      return buildAnswer(
        await this.appendCumulativeQuantityDisclaimer(finalAnswer),
        this.toolCalls,
      );
    }
    return buildAnswer(
      answerHint || 'Xin lỗi, mình chưa có câu trả lời phù hợp.',
      this.toolCalls,
    );
  }

  // HH1 (manual_test_bank_heavy.md) — Fix #3 (react-loop-run.ts) chỉ so
  // required/achieved TRONG 1 ReactLoopService.run(); khi Supervisor tách
  // nhiều step cho CÙNG 1 yêu cầu số lượng, mỗi step tự thấy đủ cục bộ dù
  // TỔNG cả turn đã lệch. Check lại 1 lần CUỐI ở đây bằng resultPreview của
  // TOÀN BỘ toolCalls turn (this.toolCalls đã cộng dồn qua mọi step/resume).
  // Bỏ qua (không tốn thêm LLM call) nếu turn không có tool call thật nào.
  private async appendCumulativeQuantityDisclaimer(
    answer: string,
  ): Promise<string> {
    if (this.toolCalls.length === 0) return answer;

    const { requiredCount, achievedCount } =
      await this.supervisor.checkCumulativeQuantity(
        this.prompt,
        this.toolCalls,
        this.signal,
      );
    if (requiredCount > 0 && achievedCount !== requiredCount) {
      return `${answer}\n\n⚠️ Yêu cầu cần xử lý đúng ${requiredCount}, nhưng theo kết quả tool THẬT chỉ xác nhận được ${achievedCount}.`;
    }
    return answer;
  }

  private async runEvaluateAndDecide(
    completedRound: SupervisorRoundDto,
    remainingSteps: DelegationDto[],
  ): Promise<EvaluateOutcome> {
    const verdict = await this.supervisor.evaluate(
      this.prompt,
      completedRound,
      remainingSteps,
      this.signal,
    );
    if (verdict.verdict === ESupervisorVerdict.DONE) {
      if (!hasPendingActionStep(remainingSteps)) {
        return ESupervisorVerdict.FINALIZE;
      }
      this.logger.warn(
        `evaluate() trả 'done' nhưng còn bước HÀNH ĐỘNG/KIỂM TRA chưa chạy (${remainingSteps.map((s) => s.task).join('; ')}) — bác bỏ 'done', tiếp tục chạy nốt kế hoạch.`,
      );
      return ESupervisorVerdict.CONTINUE;
    }
    if (verdict.verdict === ESupervisorVerdict.REPLAN) {
      return ESupervisorVerdict.REPLAN;
    }
    return ESupervisorVerdict.CONTINUE;
  }

  private buildPreApprovalRound(
    step: DelegationDto,
    toolCallsBeforeBlock: ToolCallTraceDto[],
  ): SupervisorRoundDto | null {
    const successful = toolCallsBeforeBlock.filter(
      (tc) => tc.status === 'success',
    );
    if (successful.length === 0) return null;

    const result = successful
      .map((tc) => `${tc.tool}: ${tc.resultPreview ?? '(không có nội dung)'}`)
      .join('\n');
    return {
      agent: step.agent,
      task: `${step.task} (dữ liệu đã thu thập được TRƯỚC KHI cần duyệt 1 hành động khác trong cùng bước này)`,
      result,
    };
  }

  private findLikelyMisroutedAgent(
    step: DelegationDto,
  ): AvailableAgentDto | null {
    const chosenAgent = this.agents.find((a) => a.provider === step.agent);
    if (!chosenAgent) return null;

    const taskLower = (step.task ?? '').toLowerCase();
    if (taskLower.includes(chosenAgent.label.toLowerCase())) return null;

    return (
      this.agents.find(
        (a) =>
          a.provider !== step.agent &&
          a.label.length >= MIN_AGENT_LABEL_LENGTH_FOR_MISMATCH_CHECK &&
          taskLower.includes(a.label.toLowerCase()),
      ) ?? null
    );
  }

  private async delegateRound(
    delegation: DelegationDto,
    round: number,
  ): Promise<DelegateRoundResult | ApprovalRequiredDelegateResult | null> {
    const { userId, channelId, workspaceId, channelType } = this.data;
    const targetAgent = this.agents.find(
      (a) => a.provider === delegation.agent,
    );

    if (!targetAgent) {
      this.logger.warn(
        `Supervisor delegated to unknown/unavailable agent "${delegation.agent}" for user ${userId}`,
      );
      return null;
    }

    const task = delegation.task || this.prompt;
    const reactModelId =
      process.env.DEFAULT_REACT_MODEL ??
      ORCHESTRATION_CONSTANTS.DEFAULT_REACT_MODEL;
    const realRoundsSoFar = this.rounds.filter((r) => !isNonProgressRound(r));
    const promptWithContext =
      realRoundsSoFar.length > 0
        ? `${task}\n\nDữ liệu THẬT đã thu thập được từ (các) bước trước trong CÙNG yêu cầu này (PHẢI dùng ĐÚNG NGUYÊN VĂN, không tự bịa/diễn giải lại số liệu):\n${capRoundResultsWeighted(
            realRoundsSoFar,
            this.memoryManager.buildBudget(reactModelId).toolResultCharBudget,
          )
            .map(
              (r, i) =>
                `${i + 1}. Agent "${r.agent}" (yêu cầu: "${r.task}") → kết quả: ${r.result}`,
            )
            .join('\n')}`
        : task;
    const streamKey = `r${round}-${targetAgent.provider}`;
    await this.agentStream
      .emitStep(
        {
          userId,
          channelId,
          messageId: this.replyMessageId,
          channelType,
          streamKey,
        },
        { type: 'step_start', label: `${targetAgent.label}: ${task}` },
      )
      .catch(() => {});
    try {
      const { answer, toolCalls } = await this.reactLoop.run(
        {
          prompt: promptWithContext,
          provider: targetAgent.provider,
          userId,
          channelId,
          workspaceId,
          messageId: this.replyMessageId,
          channelType,
          history: this.history,
          streamKey,
        },
        this.signal,
        this.repeatGuard,
      );
      return {
        round: { agent: targetAgent.provider, task, result: answer },
        toolCalls,
      };
    } catch (error) {
      if (error instanceof TurnCancelledError) {
        // ReactLoop's own partialText chỉ là phần dở của round NÀY — gộp
        // thêm các round TRƯỚC đã xong (xem buildCancelledPartialText).
        throw new TurnCancelledError(
          buildCancelledPartialText(this.rounds, error.partialText),
        );
      }
      if (error instanceof ApprovalRequiredError) {
        return {
          approvalRequired: error.pendingTool,
          task,
          toolCalls: error.toolCalls,
        };
      }
      this.logger.error(
        `ReactLoop failed for agent "${targetAgent.provider}": ${(error as Error).message}`,
        (error as Error).stack,
      );
      return {
        round: {
          agent: targetAgent.provider,
          task,
          result: describeExternalServiceError(error),
        },
        toolCalls: [],
      };
    }
  }
}
