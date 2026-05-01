import { Processor } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Inject } from '@nestjs/common';
import {
  NAME_SERVICE_TCP,
  CHANNEL_MESSAGE_PATTERN,
  NotificationType,
} from '@slack/constants';
import {
  QueueService,
  EQueueName,
  BaseProcessor,
  EJobName,
  ICreateNotificationJobData,
} from '@slack/queue';
import { ClientProxy } from '@nestjs/microservices';
import { lastValueFrom } from 'rxjs';
import { NotificationService } from '../services/impl/notification.service';

@Processor(EQueueName.NOTIFICATION_QUEUE)
export class NotificationProcessor extends BaseProcessor<
  ICreateNotificationJobData,
  void,
  EJobName
> {
  constructor(
    private readonly notificationService: NotificationService,
    @Inject(NAME_SERVICE_TCP.CHANNEL_SERVICE)
    private readonly channelClient: ClientProxy,
    private readonly queueService: QueueService,
  ) {
    super();
  }

  async process(
    job: Job<ICreateNotificationJobData, void, EJobName>,
  ): Promise<void> {
    const { channelId, senderId, messageId, mentions, parentId } = job.data;

    try {
      // 1. Lấy danh sách thành viên trong channel qua TCP
      const members: any[] = await lastValueFrom(
        this.channelClient.send(CHANNEL_MESSAGE_PATTERN.GET_MEMBERS, {
          channelId,
        }),
      );

      if (!members || !Array.isArray(members)) {
        this.logger.warn(`No members found for channel ${channelId}`);
        return;
      }

      // 2. Lọc ra danh sách những người cần nhận thông báo (trừ người gửi)
      const recipients = members.filter((m) => m.userId !== senderId);

      // 3. Xử lý lưu DB và bắn Socket cho từng người
      const promises = recipients.map(async (member) => {
        // Xác định loại thông báo
        let notificationType = NotificationType.MESSAGE_RECEIVED;

        if (mentions?.some((men: any) => men.userId === member.userId)) {
          notificationType = NotificationType.MENTIONED_IN_MESSAGE;
        } else if (parentId) {
          notificationType = NotificationType.REPLY_IN_THREAD;
        }

        // A. Lưu vào Database Notification và Bắn Socket Realtime (đã tích hợp trong Service)
        await this.notificationService.pushNotification({
          recipientId: member.userId,
          type: notificationType,
          templateKey: notificationType,
          objectId: messageId,
          objectType: 'message',
          metadata: {
            channelId,
            senderId,
            parentId,
          },
        });
      });

      await Promise.all(promises);

      this.logger.log(
        `Processed notifications for ${recipients.length} recipients in channel ${channelId}`,
      );
    } catch (error) {
      this.logger.error(`Failed to process notification job: ${error.message}`);
      throw error;
    }
  }
}
