import { Injectable, Logger } from '@nestjs/common';
import { IProcessAiTriggerJobData } from '@slack/queue';
import { ORCHESTRATION_CONSTANTS } from '@slack/constants';
import { MessageClientService } from '../message-client.service';
import { ReactLoopService } from '../llm/react-loop.service';
import { SupervisorService } from '../llm/supervisor.service';
import { AgentStreamService } from '../socket/agent-stream.service';
import {
  AvailableAgentDto,
  DelegationDto,
  SupervisorRoundDto,
} from '../dto/supervisor.dto';
import { ToolCallTraceDto } from '../dto/react-loop.dto';
import { ChatHistoryTurnDto } from '../dto/message-client.dto';
import { AgentCancellationService } from '../cancellation/agent-cancellation.service';
import { runCancellable } from '../common/cancellable-run.util';
import { TurnCancelledError } from '../llm/turn-cancelled.error';
import { CheckpointPauseService } from './checkpoint-pause.service';
import { MetricsRegistryService } from '../common/metrics-registry.service';
import { AnswerResult } from './orchestration-answer.types';
import { TurnResolverRun } from './turn-resolver-run';

// Ghi chú thiết kế đầy đủ (WHY): slack-docs/Documents/Orchestration/code-notes/turn-resolver.service.md
// Logic chi tiết 1 turn (plan/delegate/evaluate/synthesize) nằm ở
// TurnResolverRun (turn-resolver-run.ts) — file này chỉ dựng dependencies
// rồi giao việc, giữ nguyên API công khai (continueRounds()/resolveAnswer())
// vì ApprovalFlowService/CheckpointPauseService gọi thẳng vào đây.
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
    const runTurn = (sig?: AbortSignal) =>
      new TurnResolverRun(
        {
          data,
          replyMessageId,
          prompt,
          agents,
          history,
          rounds,
          toolCalls,
          signal: sig,
        },
        {
          reactLoop: this.reactLoop,
          supervisor: this.supervisor,
          agentStream: this.agentStream,
          cancellation: this.cancellation,
          checkpointPause: this.checkpointPause,
          metrics: this.metrics,
          logger: this.logger,
        },
      ).run(forcedStep, remainingSteps);

    if (signal) {
      return runTurn(signal);
    }

    return runCancellable(
      replyMessageId,
      this.cancellation,
      (sig) => runTurn(sig),
      () => {
        const partialText =
          rounds.length > 0 ? rounds[rounds.length - 1].result : undefined;
        return new TurnCancelledError(partialText);
      },
    );
  }
}
