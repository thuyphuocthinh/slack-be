import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { CheckpointService } from './checkpoint.service';
import { MessageClientService } from '../message-client.service';
import { AgentStreamService } from '../socket/agent-stream.service';
import { OrchestrationCheckpointStatus } from '../entity/orchestration-checkpoint.entity';
import { CheckpointResponseDto } from '../dto/checkpoint.dto';

/**
 * Giai đoạn 3 (HITL), Step 8 — checkpoint pending quá hạn (mặc định 24h, xem
 * ORCHESTRATION_CONSTANTS.CHECKPOINT_EXPIRY_MS) tự động bị từ chối, tránh 1
 * checkpoint bị người dùng bỏ quên treo "pending" vĩnh viễn.
 */
@Injectable()
export class CheckpointCleanupService {
  private readonly logger = new Logger(CheckpointCleanupService.name);

  constructor(
    private readonly checkpoint: CheckpointService,
    private readonly messageClient: MessageClientService,
    private readonly agentStream: AgentStreamService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR, { name: 'expire-orchestration-checkpoints' })
  async expirePendingCheckpoints(): Promise<void> {
    const expired = await this.checkpoint.findExpiredPending();
    if (expired.length === 0) return;

    this.logger.log(
      `expirePendingCheckpoints() found ${expired.length} expired checkpoint(s)`,
    );

    await Promise.all(expired.map((checkpoint) => this.expireOne(checkpoint)));
  }

  // dùng chung claim() atomic (Step 5) — nếu user vừa bấm Approve/Reject
  // đúng lúc job này chạy, claim() thua cuộc đua (affected=0) và bị bỏ qua,
  // không đè lên kết quả user vừa xử lý.
  private async expireOne(
    checkpoint: Pick<
      CheckpointResponseDto,
      'id' | 'replyMessageId' | 'userId' | 'channelId' | 'channelType'
    >,
  ): Promise<void> {
    const { claimed } = await this.checkpoint.claim({
      id: checkpoint.id,
      toStatus: OrchestrationCheckpointStatus.REJECTED,
    });
    if (!claimed) return;

    await this.messageClient.updateMessage({
      id: checkpoint.replyMessageId,
      userId: checkpoint.userId,
      content: '⏱️ Yêu cầu duyệt đã hết hạn, tự động huỷ.',
    });
    await this.agentStream.emitStep(
      {
        userId: checkpoint.userId,
        channelId: checkpoint.channelId,
        messageId: checkpoint.replyMessageId,
        channelType: checkpoint.channelType,
      },
      { type: 'done' },
    );
  }
}
