import { Injectable, Logger } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { EJobName, EQueueName, QueueService } from '@slack/queue';
import { ORCHESTRATION_ERROR } from '@slack/constants';
import { MessageClientService } from '../message-client.service';
import { AgentStreamService } from '../socket/agent-stream.service';
import { CheckpointService } from '../checkpoint/checkpoint.service';
import {
  OrchestrationCheckpointStatus,
  PendingToolCall,
} from '../entity/orchestration-checkpoint.entity';
import { CheckpointResponseDto } from '../dto/checkpoint.dto';
import { ResolveApprovalRequestDto } from '../dto/orchestration.dto';

@Injectable()
export class ApprovalRequestService {
  private readonly logger = new Logger(ApprovalRequestService.name);

  constructor(
    private readonly messageClient: MessageClientService,
    private readonly agentStream: AgentStreamService,
    private readonly checkpoint: CheckpointService,
    private readonly queueService: QueueService,
  ) { }

  async resolveApproval(dto: ResolveApprovalRequestDto): Promise<void> {
    const checkpoint = await this.loadOwnedCheckpoint(dto);
    this.validateActionAndKind(dto, checkpoint);

    const toStatus =
      dto.action === 'reject'
        ? OrchestrationCheckpointStatus.REJECTED
        : OrchestrationCheckpointStatus.APPROVED;
    const updatedPendingTool =
      dto.action === 'edit_and_approve'
        ? this.validateAndApplyEditedArgs(dto, checkpoint)
        : undefined;

    const { claimed } = await this.checkpoint.claim({
      id: checkpoint.id,
      toStatus,
      ...(dto.action === 'clarify' && {
        selectedProvider: dto.selectedProvider,
      }),
      ...(updatedPendingTool && { updatedPendingTool }),
    });
    if (!claimed) {
      throw new RpcException(ORCHESTRATION_ERROR.CHECKPOINT_ALREADY_RESOLVED);
    }

    if (dto.action === 'reject') {
      await this.rejectCheckpoint(checkpoint, dto.userId);
      return;
    }

    await this.enqueueApprovalJob(checkpoint, dto.userId);
  }

  private async enqueueApprovalJob(
    checkpoint: CheckpointResponseDto,
    userId: string,
  ): Promise<void> {
    try {
      await this.queueService.addJob(
        EQueueName.AI_ORCHESTRATION_QUEUE,
        EJobName.PROCESS_APPROVAL,
        { checkpointId: checkpoint.id, userId },
        { attempts: 1 },
      );
    } catch (error) {
      this.logger.error(
        `resolveApproval() failed to enqueue PROCESS_APPROVAL for checkpoint ${checkpoint.id}, reverting claim: ${(error as Error).message}`,
      );
      await this.checkpoint.revertApprovedClaim({ id: checkpoint.id });
      throw new RpcException(
        ORCHESTRATION_ERROR.CHECKPOINT_APPROVAL_ENQUEUE_FAILED,
      );
    }
  }

  private validateActionAndKind(
    dto: ResolveApprovalRequestDto,
    checkpoint: CheckpointResponseDto,
  ): void {
    const kindMatchesAction =
      dto.action === 'clarify'
        ? checkpoint.kind === 'clarification' && Boolean(dto.selectedProvider)
        : checkpoint.kind === 'approval';
    if (!kindMatchesAction) {
      throw new RpcException(ORCHESTRATION_ERROR.CHECKPOINT_ACTION_MISMATCH);
    }
  }

  private validateAndApplyEditedArgs(
    dto: ResolveApprovalRequestDto,
    checkpoint: CheckpointResponseDto,
  ): PendingToolCall {
    if (!checkpoint.pendingTool || !dto.editedArgs) {
      throw new RpcException(ORCHESTRATION_ERROR.CHECKPOINT_ACTION_MISMATCH);
    }

    const originalArgs = checkpoint.pendingTool.args || {};
    const editedArgs = dto.editedArgs;
    const FORBIDDEN_KEYS = ['id', 'name'];
    const FORBIDDEN_VALUES = ['', null, undefined];

    const hasUnknownKey = Object.keys(editedArgs).some(
      (key) => !(key in originalArgs) || FORBIDDEN_KEYS.includes(key),
    );
    const hasForbiddenValue = Object.values(editedArgs).some((value) =>
      FORBIDDEN_VALUES.includes(value as any),
    );
    if (hasUnknownKey || hasForbiddenValue) {
      throw new RpcException(ORCHESTRATION_ERROR.CHECKPOINT_ACTION_MISMATCH);
    }

    return {
      ...checkpoint.pendingTool,
      args: { ...originalArgs, ...editedArgs },
    };
  }

  private async loadOwnedCheckpoint(
    dto: ResolveApprovalRequestDto,
  ): Promise<CheckpointResponseDto> {
    const checkpoint = await this.checkpoint.findPendingByReplyMessageId({
      replyMessageId: dto.messageId,
    });
    if (!checkpoint) {
      throw new RpcException(ORCHESTRATION_ERROR.CHECKPOINT_NOT_FOUND);
    }
    if (checkpoint.userId !== dto.userId) {
      this.logger.warn(
        `User ${dto.userId} tried to resolve checkpoint ${checkpoint.id} owned by ${checkpoint.userId}`,
      );
      throw new RpcException(ORCHESTRATION_ERROR.CHECKPOINT_FORBIDDEN);
    }
    return checkpoint;
  }

  private async rejectCheckpoint(
    checkpoint: CheckpointResponseDto,
    userId: string,
  ): Promise<void> {
    const { replyMessageId, botUserId, channelId, channelType } = checkpoint;
    await this.messageClient.updateMessage({
      id: replyMessageId,
      userId: botUserId,
      content: '❌ Đã huỷ theo yêu cầu.',
    });
    await this.agentStream
      .emitStep(
        { userId, channelId, messageId: replyMessageId, channelType },
        { type: 'done' },
      )
      .catch((error) =>
        this.logger.warn(
          `emitStep('done') failed: ${(error as Error).message}`,
        ),
      );
  }
}
