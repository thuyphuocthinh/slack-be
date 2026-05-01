import { Processor } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import {
  EQueueName,
  BaseProcessor,
  EJobName,
  QueueService,
  IIncrementUnreadJobData,
} from '@slack/queue';
import { ESocketEvent } from '@slack/constants';
import { ChannelMemberService } from '../service/channel-member.service';

export interface IChannelProcessResult {
  success: boolean;
  recipients: number;
}

@Processor(EQueueName.CHANNEL_QUEUE)
export class ChannelProcessor extends BaseProcessor<
  IIncrementUnreadJobData,
  IChannelProcessResult,
  EJobName
> {
  constructor(
    private readonly channelMemberService: ChannelMemberService,
    private readonly queueService: QueueService,
  ) {
    super();
  }

  async process(
    job: Job<IIncrementUnreadJobData, IChannelProcessResult, EJobName>,
  ): Promise<IChannelProcessResult> {
    const { channelId, senderId } = job.data;

    if (job.name === EJobName.INCREMENT_UNREAD_COUNT) {
      try {
        this.logger.log(`Incrementing unread count for channel ${channelId}`);

        // 1. Tăng unread count trong DB và lấy danh sách member mới cập nhật
        const updatedMembers =
          await this.channelMemberService.incrementUnreadCount(
            channelId,
            senderId,
          );

        if (updatedMembers && Array.isArray(updatedMembers)) {
          // 2. Bắn tín hiệu socket cập nhật unread count cho từng thành viên
          const socketPromises = updatedMembers
            .filter((m) => m.memberId !== senderId) // Không bắn cho sender
            .map(async (m) => {
              await this.queueService.addJob(
                EQueueName.SOCKET_QUEUE,
                EJobName.EMIT_EVENT,
                {
                  event: ESocketEvent.CHANNEL_UNREAD_UPDATED,
                  room: `user_${m.memberId}`,
                  data: {
                    channelId,
                    unreadCount: m.unreadCount,
                  },
                },
              );
            });
          await Promise.all(socketPromises);
        }

        return { success: true, recipients: updatedMembers?.length || 0 };
      } catch (error) {
        this.logger.error(`Failed to increment unread count: ${error.message}`);
        throw error;
      }
    }

    return { success: false, recipients: 0 };
  }
}
