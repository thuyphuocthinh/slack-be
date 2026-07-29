import { Injectable, Logger } from '@nestjs/common';
import { IProcessAiTriggerJobData } from '@slack/queue';
import { ORCHESTRATION_CONSTANTS } from '@slack/constants';
import { MessageClientService } from '../message-client.service';
import { ReactLoopService } from '../llm/react-loop.service';
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
import {
  capRoundResults,
  resolveDataCharBudget,
} from '../executor/tool-result-size-cap.util';
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

// Ghi chú thiết kế đầy đủ (WHY): slack-docs/Documents/Orchestration/code-notes/turn-resolver.service.md
@Injectable()
export class TurnResolverService {
  private readonly logger = new Logger(TurnResolverService.name);

  constructor(
    private readonly messageClient: MessageClientService,
    private readonly reactLoop: ReactLoopService,
    private readonly supervisor: SupervisorService,
    private readonly agentStream: AgentStreamService,
    private readonly cancellation: AgentCancellationService,
    private readonly checkpointPause: CheckpointPauseService,
    private readonly metrics: MetricsRegistryService,
  ) {}

  async resolveAnswer(
    data: IProcessAiTriggerJobData,
    replyMessageId: string,
  ): Promise<AnswerResult> {
    const { userId, channelId, messageId } = data;
    const [prompt, agents, history] = await Promise.all([
      this.messageClient.getMessageText({ id: messageId, userId }),
      this.supervisor.getAvailableAgents(userId),
      this.messageClient.getRecentHistory({
        channelId,
        userId,
        beforeMessageId: messageId,
        limit: ORCHESTRATION_CONSTANTS.CHAT_HISTORY_LIMIT,
      }),
    ]);

    return this.continueRounds(
      data,
      replyMessageId,
      prompt,
      agents,
      history,
      [],
      [],
    );
  }

  async continueRounds(
    data: IProcessAiTriggerJobData,
    replyMessageId: string,
    prompt: string,
    agents: AvailableAgentDto[],
    history: ChatHistoryTurnDto[],
    rounds: SupervisorRoundDto[],
    toolCalls: ToolCallTraceDto[],
    forcedStep?: DelegationDto,
    remainingSteps?: DelegationDto[],
    signal?: AbortSignal,
  ): Promise<AnswerResult> {
    if (signal) {
      return this.continueRoundsInternal(
        data,
        replyMessageId,
        prompt,
        agents,
        history,
        rounds,
        toolCalls,
        forcedStep,
        remainingSteps,
        signal,
      );
    }

    return runCancellable(
      replyMessageId,
      this.cancellation,
      async (sig) => {
        return this.continueRoundsInternal(
          data,
          replyMessageId,
          prompt,
          agents,
          history,
          rounds,
          toolCalls,
          forcedStep,
          remainingSteps,
          sig,
        );
      },
      () => {
        const partialText =
          rounds.length > 0 ? rounds[rounds.length - 1].result : undefined;
        return new TurnCancelledError(partialText);
      },
    );
  }

  private async continueRoundsInternal(
    data: IProcessAiTriggerJobData,
    replyMessageId: string,
    prompt: string,
    agents: AvailableAgentDto[],
    history: ChatHistoryTurnDto[],
    rounds: SupervisorRoundDto[],
    toolCalls: ToolCallTraceDto[],
    forcedStep?: DelegationDto,
    remainingSteps?: DelegationDto[],
    signal?: AbortSignal,
  ): Promise<AnswerResult> {
    const { userId, channelId, channelType } = data;

    let nonProgressRounds = rounds.filter(
      (r) =>
        r.result.startsWith(GUARDRAIL_BLOCKED_MARKER) ||
        r.result.startsWith(REPLAN_MARKER),
    ).length;
    let realStepsRun = rounds.length - nonProgressRounds;
    let steps: DelegationDto[] = forcedStep
      ? [forcedStep, ...(remainingSteps ?? [])]
      : (remainingSteps ?? []);
    let needsPlan = !forcedStep && remainingSteps === undefined;
    const agentRankingCache: AgentRankingCache = {};

    if (!forcedStep && remainingSteps !== undefined && rounds.length > 0) {
      const lastRound = rounds[rounds.length - 1];
      const outcome = await this.runEvaluateAndDecide(
        prompt,
        lastRound,
        steps,
        signal,
      );
      if (outcome === 'finalize') {
        return this.finalizeAnswer(
          data,
          replyMessageId,
          prompt,
          rounds,
          toolCalls,
          undefined,
          signal,
        );
      }
      if (outcome === 'replan') {
        nonProgressRounds++;
        this.metrics.incrementBehaviorSignal('replan');
        rounds.push({
          agent: lastRound.agent,
          task: lastRound.task,
          result: `${REPLAN_MARKER} evaluate() cho rằng bước vừa xong không đạt kỳ vọng, đã lập lại kế hoạch.`,
        });
        needsPlan = true;
        steps = [];
      }
    }

    while (
      realStepsRun < ORCHESTRATION_CONSTANTS.MAX_REAL_STEPS_PER_TURN &&
      nonProgressRounds < ORCHESTRATION_CONSTANTS.MAX_SUPERVISOR_ROUNDS
    ) {
      if (
        signal?.aborted ||
        (await this.cancellation.isCancelled(replyMessageId))
      ) {
        throw new TurnCancelledError(
          rounds.length > 0 ? rounds[rounds.length - 1].result : undefined,
        );
      }

      if (needsPlan) {
        const plan = await this.supervisor.plan(
          prompt,
          agents,
          rounds,
          history,
          agentRankingCache,
          signal,
          channelId,
        );

        if (plan.action === 'respond') {
          return this.finalizeAnswer(
            data,
            replyMessageId,
            prompt,
            rounds,
            toolCalls,
            plan.answer,
            signal,
          );
        }

        steps = plan.steps ?? [];

        steps.forEach((s) => {
          const safeAgent = s.agent || '';
          const matchedAgent = agents.find(
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

        if (steps.every((s) => !agents.some((a) => a.provider === s.agent))) {
          const attemptedAgents = steps
            .map((s) => s.agent || 'unknown')
            .join(', ');
          return buildAnswer(
            plan.answer ||
              `Mình chưa thể xử lý yêu cầu này với các kết nối hiện có (Tên hệ thống mà AI đang cố gọi: "${attemptedAgents}" - Vui lòng đổi tên hoặc viết đúng tên). Vào Settings để kết nối agent phù hợp nhé.`,
            toolCalls,
          );
        }
        if (
          process.env.ENABLE_CLARIFICATION_HITL === 'true' &&
          plan.ambiguousCandidates?.some((c) => c.provider === steps[0]?.agent)
        ) {
          this.metrics.incrementBehaviorSignal('clarification_required');
          return this.checkpointPause.pauseForClarification(
            data,
            prompt,
            rounds,
            toolCalls,
            history,
            steps[0].task,
            plan.ambiguousCandidates,
            steps.slice(1),
          );
        }

        needsPlan = false;
      }

      if (steps.length === 0) {
        return this.finalizeAnswer(
          data,
          replyMessageId,
          prompt,
          rounds,
          toolCalls,
          undefined,
          signal,
        );
      }

      const step = steps.shift()!;

      const misroutedTo = this.findLikelyMisroutedAgent(step, agents);
      if (misroutedTo) {
        this.logger.warn(
          `Guardrail: bước chọn agent "${step.agent}" nhưng task nhắc rõ hệ thống "${misroutedTo.label}" (provider "${misroutedTo.provider}") — nghi ngờ chọn sai, re-plan sớm thay vì thực thi mù.`,
        );
        rounds.push({
          agent: step.agent,
          task: step.task,
          result: `${GUARDRAIL_BLOCKED_MARKER} — kế hoạch chọn hệ thống "${step.agent}" nhưng yêu cầu nhắc rõ tới hệ thống "${misroutedTo.label}" (đã kết nối, provider "${misroutedTo.provider}") — có khả năng chọn sai agent, cần lập lại kế hoạch.`,
        });
        nonProgressRounds++;
        this.metrics.incrementBehaviorSignal('misroute_guardrail');
        needsPlan = true;
        steps = [];
        continue;
      }

      const result = await this.delegateRound(
        step,
        agents,
        data,
        prompt,
        replyMessageId,
        history,
        realStepsRun,
        rounds,
        signal,
      );
      realStepsRun++;

      if (result && 'approvalRequired' in result) {
        toolCalls.push(...result.toolCalls);
        const preApprovalRound = this.buildPreApprovalRound(
          step,
          result.toolCalls,
        );
        if (preApprovalRound) rounds.push(preApprovalRound);
        this.metrics.incrementBehaviorSignal('approval_required');
        return this.checkpointPause.pauseForApproval(
          data,
          prompt,
          rounds,
          toolCalls,
          history,
          result,
          steps,
        );
      }

      const completedRound: SupervisorRoundDto = result
        ? result.round
        : {
            agent: step.agent,
            task: step.task,
            result:
              'Agent này chưa khả dụng (chưa kết nối hoặc chưa có hạ tầng) — bỏ qua, không thực hiện được phần việc này.',
          };
      rounds.push(completedRound);
      if (result) toolCalls.push(...result.toolCalls);

      const outcome = await this.runEvaluateAndDecide(
        prompt,
        completedRound,
        steps,
        signal,
      );
      if (outcome === 'finalize') {
        return this.finalizeAnswer(
          data,
          replyMessageId,
          prompt,
          rounds,
          toolCalls,
          undefined,
          signal,
        );
      }
      if (outcome === 'replan') {
        nonProgressRounds++;
        this.metrics.incrementBehaviorSignal('replan');
        rounds.push({
          agent: completedRound.agent,
          task: completedRound.task,
          result: `${REPLAN_MARKER} evaluate() cho rằng bước vừa xong không đạt kỳ vọng, đã lập lại kế hoạch.`,
        });
        needsPlan = true;
        steps = [];
      }
    }

    this.logger.warn(
      `Supervisor chưa hội tụ (realSteps=${realStepsRun}/${ORCHESTRATION_CONSTANTS.MAX_REAL_STEPS_PER_TURN}, nonProgress=${nonProgressRounds}/${ORCHESTRATION_CONSTANTS.MAX_SUPERVISOR_ROUNDS}) cho user ${userId}, tổng hợp lại kết quả đã có`,
    );
    this.metrics.incrementBehaviorSignal('non_convergence');
    await this.agentStream
      .emitStep(
        { userId, channelId, messageId: replyMessageId, channelType },
        {
          type: 'step_start',
          label: 'Tổng hợp câu trả lời',
          kind: 'synthesize',
        },
      )
      .catch(() => {});
    const fallbackAccumulator = { text: '' };
    const finalAnswer = await runCancellable(
      replyMessageId,
      this.cancellation,
      (sig) =>
        this.supervisor.synthesize(
          prompt,
          rounds,
          buildOnToken(
            this.agentStream,
            userId,
            channelId,
            replyMessageId,
            channelType,
            fallbackAccumulator,
          ),
          sig,
        ),
      () => new TurnCancelledError(fallbackAccumulator.text || undefined),
      signal,
    );
    return buildAnswer(finalAnswer, toolCalls);
  }

  private async finalizeAnswer(
    data: IProcessAiTriggerJobData,
    replyMessageId: string,
    prompt: string,
    rounds: SupervisorRoundDto[],
    toolCalls: ToolCallTraceDto[],
    answerHint?: string,
    signal?: AbortSignal,
  ): Promise<AnswerResult> {
    const { userId, channelId, channelType } = data;

    if (rounds.length === 1) {
      return buildAnswer(rounds[0].result, toolCalls);
    }
    if (rounds.length > 1) {
      await this.agentStream
        .emitStep(
          { userId, channelId, messageId: replyMessageId, channelType },
          {
            type: 'step_start',
            label: 'Tổng hợp câu trả lời',
            kind: 'synthesize',
          },
        )
        .catch(() => {});
      const accumulator = { text: '' };
      const finalAnswer = await runCancellable(
        replyMessageId,
        this.cancellation,
        (sig) =>
          this.supervisor.synthesize(
            prompt,
            rounds,
            buildOnToken(
              this.agentStream,
              userId,
              channelId,
              replyMessageId,
              channelType,
              accumulator,
            ),
            sig,
          ),
        () => new TurnCancelledError(accumulator.text || undefined),
        signal,
      );
      return buildAnswer(finalAnswer, toolCalls);
    }
    return buildAnswer(
      answerHint || 'Xin lỗi, mình chưa có câu trả lời phù hợp.',
      toolCalls,
    );
  }

  private async runEvaluateAndDecide(
    prompt: string,
    completedRound: SupervisorRoundDto,
    remainingSteps: DelegationDto[],
    signal?: AbortSignal,
  ): Promise<'finalize' | 'replan' | 'continue'> {
    const verdict = await this.supervisor.evaluate(
      prompt,
      completedRound,
      remainingSteps,
      signal,
    );
    if (verdict.verdict === 'done') {
      if (!hasPendingActionStep(remainingSteps)) {
        return 'finalize';
      }
      this.logger.warn(
        `evaluate() trả 'done' nhưng còn bước HÀNH ĐỘNG/KIỂM TRA chưa chạy (${remainingSteps.map((s) => s.task).join('; ')}) — bác bỏ 'done', tiếp tục chạy nốt kế hoạch.`,
      );
      return 'continue';
    }
    if (verdict.verdict === 're-plan') {
      return 'replan';
    }
    return 'continue';
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
    agents: AvailableAgentDto[],
  ): AvailableAgentDto | null {
    const chosenAgent = agents.find((a) => a.provider === step.agent);
    if (!chosenAgent) return null;

    const taskLower = (step.task ?? '').toLowerCase();
    if (taskLower.includes(chosenAgent.label.toLowerCase())) return null;

    return (
      agents.find(
        (a) =>
          a.provider !== step.agent &&
          a.label.length >= MIN_AGENT_LABEL_LENGTH_FOR_MISMATCH_CHECK &&
          taskLower.includes(a.label.toLowerCase()),
      ) ?? null
    );
  }

  private async delegateRound(
    delegation: DelegationDto,
    agents: AvailableAgentDto[],
    data: IProcessAiTriggerJobData,
    originalPrompt: string,
    replyMessageId: string,
    history: ChatHistoryTurnDto[],
    round: number,
    roundsSoFar: SupervisorRoundDto[],
    signal?: AbortSignal,
  ): Promise<DelegateRoundResult | ApprovalRequiredDelegateResult | null> {
    const { userId, channelId, workspaceId, channelType } = data;
    const targetAgent = agents.find((a) => a.provider === delegation.agent);

    if (!targetAgent) {
      this.logger.warn(
        `Supervisor delegated to unknown/unavailable agent "${delegation.agent}" for user ${userId}`,
      );
      return null;
    }

    const task = delegation.task || originalPrompt;
    const reactModelId =
      process.env.DEFAULT_REACT_MODEL ??
      ORCHESTRATION_CONSTANTS.DEFAULT_REACT_MODEL;
    const realRoundsSoFar = roundsSoFar.filter(
      (r) =>
        !r.result.startsWith(GUARDRAIL_BLOCKED_MARKER) &&
        !r.result.startsWith(REPLAN_MARKER),
    );
    const promptWithContext =
      realRoundsSoFar.length > 0
        ? `${task}\n\nDữ liệu THẬT đã thu thập được từ (các) bước trước trong CÙNG yêu cầu này (PHẢI dùng ĐÚNG NGUYÊN VĂN, không tự bịa/diễn giải lại số liệu):\n${capRoundResults(
            realRoundsSoFar,
            resolveDataCharBudget(reactModelId),
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
          messageId: replyMessageId,
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
          messageId: replyMessageId,
          channelType,
          history,
          streamKey,
        },
        signal,
      );
      return {
        round: { agent: targetAgent.provider, task, result: answer },
        toolCalls,
      };
    } catch (error) {
      if (error instanceof TurnCancelledError) {
        throw error;
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
