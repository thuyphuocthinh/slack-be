import { Injectable, Logger } from '@nestjs/common';
import { IProcessApprovalJobData } from '@slack/queue';
import { ORCHESTRATION_CONSTANTS } from '@slack/constants';
import { extractTextFromMcpResult } from '@slack/common';
import { MessageClientService } from '../message-client.service';
import { SupervisorService } from '../llm/supervisor.service';
import { McpClientService } from '../mcp/mcp-client.service';
import { AgentStreamService } from '../socket/agent-stream.service';
import { describeExternalServiceError } from '../llm/external-service-error.util';
import { CheckpointService } from '../checkpoint/checkpoint.service';
import { CheckpointResponseDto } from '../dto/checkpoint.dto';
import { DelegationDto } from '../dto/supervisor.dto';
import { AgentCancellationService } from '../cancellation/agent-cancellation.service';
import { TurnCancelledError } from '../llm/turn-cancelled.error';
import { TurnResolverService } from './turn-resolver.service';
import { capToolResultSize } from '../executor/tool-result-size-cap.util';
import { MemoryManagerService } from '../memory/memory-manager.service';
import { ApprovalContinuationPlannerService } from './approval-continuation-planner.service';
import { ApprovalSkillRecorderService } from './approval-skill-recorder.service';
import { AnswerResult } from './orchestration-answer.types';

interface TurnContext {
  userId: string;
  channelId: string;
  workspaceId: string;
  messageId: string;
  botUserId: string;
  channelType: string;
}

@Injectable()
export class ApprovalExecutionService {
  private readonly logger = new Logger(ApprovalExecutionService.name);

  constructor(
    private readonly messageClient: MessageClientService,
    private readonly supervisor: SupervisorService,
    private readonly agentStream: AgentStreamService,
    private readonly checkpoint: CheckpointService,
    private readonly mcpClient: McpClientService,
    private readonly cancellation: AgentCancellationService,
    private readonly turnResolver: TurnResolverService,
    private readonly memoryManager: MemoryManagerService,
    private readonly continuationPlanner: ApprovalContinuationPlannerService,
    private readonly skillRecorder: ApprovalSkillRecorderService,
  ) { }

  async processApprovalJob(data: IProcessApprovalJobData): Promise<void> {
    const checkpoint = await this.checkpoint.findById({
      id: data.checkpointId,
    });
    if (!checkpoint) {
      this.logger.error(
        `processApprovalJob() checkpoint ${data.checkpointId} not found`,
      );
      return;
    }

    const { claimed } = await this.checkpoint.claimExecution({
      id: checkpoint.id,
    });
    if (!claimed) {
      this.logger.warn(
        `processApprovalJob() checkpoint ${checkpoint.id} đã được thực thi trước đó — bỏ qua (job bị retry/redeliver)`,
      );
      return;
    }

    if (checkpoint.kind === 'clarification') {
      await this.resolveClarificationCheckpoint(checkpoint, data.userId);
      return;
    }
    await this.approveCheckpoint(checkpoint, data.userId);
  }

  private async emitDone(context: {
    userId: string;
    channelId: string;
    messageId: string;
    channelType: string;
  }): Promise<void> {
    await this.agentStream
      .emitStep(context, { type: 'done' })
      .catch((error) =>
        this.logger.warn(
          `emitStep('done') failed: ${(error as Error).message}`,
        ),
      );
  }

  private async runResumableTurn(
    checkpoint: CheckpointResponseDto,
    userId: string,
    label: string,
    work: () => Promise<void>,
  ): Promise<void> {
    const { id, replyMessageId, botUserId, channelId, channelType } =
      checkpoint;
    await this.cancellation.startTurn(replyMessageId, userId);
    try {
      await work();
    } catch (error) {
      if (error instanceof TurnCancelledError) {
        this.logger.log(
          `${label}() checkpoint=${id} bị huỷ theo yêu cầu (Stop)`,
        );
        await this.messageClient.tryUpdateMessage({
          id: replyMessageId,
          userId: botUserId,
          content: error.partialText || '⏹️ Đã dừng theo yêu cầu.',
        });
      } else {
        this.logger.error(
          `${label}() failed for checkpoint ${id}: ${(error as Error).message}`,
          (error as Error).stack,
        );
        await this.messageClient.tryUpdateMessage({
          id: replyMessageId,
          userId: botUserId,
          content: describeExternalServiceError(error),
        });
      }
    } finally {
      await this.emitDone({
        userId,
        channelId,
        messageId: replyMessageId,
        channelType,
      });
    }
  }

  private async finishTurn(
    checkpoint: CheckpointResponseDto,
    result: AnswerResult,
  ): Promise<void> {
    await this.messageClient.updateMessage({
      id: checkpoint.replyMessageId,
      userId: checkpoint.botUserId,
      channelId: checkpoint.channelId,
      ...result,
    });
  }

  private buildTurnContext(
    checkpoint: CheckpointResponseDto,
    userId: string,
  ): TurnContext {
    return {
      userId,
      channelId: checkpoint.channelId,
      workspaceId: checkpoint.workspaceId,
      messageId: checkpoint.replyMessageId,
      botUserId: checkpoint.botUserId,
      channelType: checkpoint.channelType,
    };
  }

  private async approveCheckpoint(
    checkpoint: CheckpointResponseDto,
    userId: string,
  ): Promise<void> {
    await this.runResumableTurn(
      checkpoint,
      userId,
      'approveCheckpoint',
      async () => {
        const pendingTool = checkpoint.pendingTool!;
        const { id, replyMessageId, botUserId } = checkpoint;
        const { text: toolResultText, isError } =
          await this.executeApprovedToolForReal(checkpoint, userId);

        if (isError) {
          this.logger.warn(
            `approveCheckpoint() checkpoint=${id} — tool "${pendingTool.provider}.${pendingTool.name}" thất bại sau khi duyệt, dừng không retry: ${toolResultText}`,
          );
          await this.checkpoint.markToolExecuted({ id });
          await this.messageClient.updateMessage({
            id: replyMessageId,
            userId: botUserId,
            content: `⚠️ Hành động "${pendingTool.name}" đã được duyệt nhưng thực thi thất bại:\n${toolResultText}`,
          });
          return;
        }

        await this.checkpoint.markToolExecuted({ id });
        await this.skillRecorder.record({
          checkpointId: id,
          workspaceId: checkpoint.workspaceId,
          pendingTask: checkpoint.pendingTask,
          pendingTool,
          riskLevel: checkpoint.riskLevel,
        });

        await this.messageClient.updateMessage({
          id: replyMessageId,
          userId: botUserId,
          content: '🤖 Đang tổng hợp kết quả...',
        });

        const { remainingSteps, resultText } =
          await this.continuationPlanner.resolveRemainingSteps(
            checkpoint,
            toolResultText,
          );
        const agents = await this.supervisor.getAvailableAgents(
          userId,
          checkpoint.workspaceId,
        );
        const rounds = [
          ...checkpoint.roundsSoFar,
          {
            agent: pendingTool.provider,
            task: checkpoint.pendingTask,
            result: resultText,
          },
        ];

        const result = await this.turnResolver.continueRounds(
          this.buildTurnContext(checkpoint, userId),
          replyMessageId,
          checkpoint.originalPrompt,
          agents,
          checkpoint.history,
          rounds,
          [],
          undefined,
          remainingSteps,
        );

        await this.finishTurn(checkpoint, result);
      },
    );
  }

  private async resolveClarificationCheckpoint(
    checkpoint: CheckpointResponseDto,
    userId: string,
  ): Promise<void> {
    await this.runResumableTurn(
      checkpoint,
      userId,
      'resolveClarificationCheckpoint',
      async () => {
        const { replyMessageId, botUserId } = checkpoint;
        await this.messageClient.updateMessage({
          id: replyMessageId,
          userId: botUserId,
          content: '🤖 Đang tổng hợp kết quả...',
        });

        const agents = await this.supervisor.getAvailableAgents(
          userId,
          checkpoint.workspaceId,
        );
        const forcedStep: DelegationDto = {
          agent: checkpoint.selectedProvider!,
          task: checkpoint.pendingTask,
        };

        const result = await this.turnResolver.continueRounds(
          this.buildTurnContext(checkpoint, userId),
          replyMessageId,
          checkpoint.originalPrompt,
          agents,
          checkpoint.history,
          checkpoint.roundsSoFar,
          [],
          forcedStep,
          checkpoint.remainingSteps,
        );

        await this.finishTurn(checkpoint, result);
      },
    );
  }

  private async executeApprovedToolForReal(
    checkpoint: CheckpointResponseDto,
    userId: string,
  ): Promise<{ text: string; isError: boolean }> {
    const pendingTool = checkpoint.pendingTool!;
    const toolResult = await this.mcpClient.callTool({
      provider: pendingTool.provider,
      name: pendingTool.name,
      args: pendingTool.args,
      ownerId: userId,
      workspaceId: checkpoint.workspaceId,
    });
    const reactModelId =
      process.env.DEFAULT_REACT_MODEL ??
      ORCHESTRATION_CONSTANTS.DEFAULT_REACT_MODEL;
    return {
      text: capToolResultSize(
        extractTextFromMcpResult(toolResult),
        this.memoryManager.buildBudget(reactModelId).toolResultCharBudget,
      ),
      isError: Boolean(toolResult.isError),
    };
  }
}
