import { Processor } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import {
  EQueueName,
  BaseProcessor,
  EJobName,
  QueueService,
} from '@slack/queue';
import { ESocketEvent } from '@slack/constants';
import { ChannelMemberService } from '../service/channel-member.service';

@Processor(EQueueName.CHANNEL_QUEUE)
export class ChannelProcessor extends BaseProcessor {
  constructor(
    private readonly channelMemberService: ChannelMemberService,
    private readonly queueService: QueueService,
  ) {
    super();
  }

  async process(job: Job<any, any, string>): Promise<any> {
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

        return { success: true, recipients: updatedMembers.length - 1 };
      } catch (error) {
        this.logger.error(`Failed to increment unread count: ${error.message}`);
        throw error;
      }
    }
  }
}
