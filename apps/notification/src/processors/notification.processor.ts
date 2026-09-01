import { Processor } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Inject } from '@nestjs/common';
import {
  NAME_SERVICE_TCP,
  CHANNEL_MESSAGE_PATTERN,
  NotificationType,
  USER_MESSAGE_PATTERNS,
} from '@slack/constants';
import {
  EQueueName,
  BaseProcessor,
  EJobName,
  ICreateNotificationJobData,
  ISendPushNotificationJobData,
} from '@slack/queue';
import { ClientProxy } from '@nestjs/microservices';
import { lastValueFrom } from 'rxjs';
import { NotificationService } from '../services/impl/notification.service';
import { FcmService } from '../services/impl/fcm.service';

// notification.md — giảm từ 10: N job cùng lúc đều tự chunk fan-out riêng,
// cộng dồn tải CPU lên chính Postgres (đo được 108-122% container CPU ở
// concurrency=10). 5 vẫn đủ song song để không xử lý tuần tự trần trụi.
@Processor(EQueueName.NOTIFICATION_QUEUE, { concurrency: 5 })
export class NotificationProcessor extends BaseProcessor<any, void, EJobName> {
  constructor(
    private readonly notificationService: NotificationService,
    private readonly fcmService: FcmService,
    @Inject(NAME_SERVICE_TCP.CHANNEL_SERVICE)
    private readonly channelClient: ClientProxy,
    @Inject(NAME_SERVICE_TCP.USER_SERVICE)
    private readonly userClient: ClientProxy,
  ) {
    super();
  }

  async process(job: Job<any, void, EJobName>): Promise<void> {
    switch (job.name) {
      case EJobName.CREATE_NOTIFICATION:
        await this.handleCreateNotification(job);
        break;
      case EJobName.SEND_PUSH_NOTIFICATION:
        await this.handleSendPushNotification(job);
        break;
      default:
        this.logger.warn(`Unknown job name: ${job.name}`);
    }
  }

  private async handleCreateNotification(
    job: Job<ICreateNotificationJobData, void, EJobName>,
  ): Promise<void> {
    const {
      channelId,
      channelName,
      senderId,
      senderName,
      messageId,
      mentions,
      parentId,
      workspaceId,
      content,
      reaction,
      recipientId,
      notificationEventId,
    } = job.data;

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

      // 2. Lọc ra danh sách những người cần nhận thông báo (trừ người gửi và lọc theo recipientId nếu có)
      const recipients = members.filter((m) => {
        if (m.memberId === senderId) return false;
        if (recipientId && m.memberId !== recipientId) return false;
        return true;
      });

      // 3. Xử lý lưu DB theo LÔ
      const NOTIFICATION_BATCH_SIZE = 20;
      for (let i = 0; i < recipients.length; i += NOTIFICATION_BATCH_SIZE) {
        const batch = recipients.slice(i, i + NOTIFICATION_BATCH_SIZE);

        const dtos = batch
          .map((member) => {
            // Xác định loại thông báo
            let notificationType = NotificationType.MESSAGE_RECEIVED;

            if (reaction) {
              notificationType = NotificationType.MESSAGE_REACTION_ADDED;
            } else if (
              mentions?.some(
                (men: any) =>
                  men.userId === member.memberId || men.userId === 'all',
              )
            ) {
              notificationType = NotificationType.MENTIONED_IN_MESSAGE;
            } else if (parentId) {
              notificationType = NotificationType.REPLY_IN_THREAD;
            }

            // Bỏ qua tin nhắn thông thường, không lưu vào DB Notification và không bắn socket realtime về Activity
            if (notificationType === NotificationType.MESSAGE_RECEIVED) {
              return null;
            }

            return {
              recipientId: member.memberId,
              type: notificationType,
              templateKey: notificationType,
              objectId: messageId,
              objectType: 'MESSAGE',
              dedupeKey: reaction
                ? `reaction-added:${notificationEventId ?? `${messageId}:${senderId}:${reaction}`}`
                : `message:${notificationType}:${messageId}`,
              workspaceId,
              content,
              metadata: {
                actorId: senderId,
                actorName: senderName,
                messageId: messageId,
                channelName: channelName || 'Direct Message',
                channelId,
                parentId,
                threadId: parentId,
                snippet: content,
                reaction,
              },
            };
          })
          .filter((dto): dto is NonNullable<typeof dto> => dto !== null);

        // A. Lưu vào Database Notification (1 câu INSERT multi-row cho cả lô)
        // và bắn Socket Realtime (đã tích hợp trong Service)
        await this.notificationService.pushNotificationsBatch(dtos);
      }

      this.logger.log(
        `Processed notifications for ${recipients.length} recipients in channel ${channelId}`,
      );
    } catch (error) {
      this.logger.error(`Failed to process notification job: ${error.message}`);
      throw error;
    }
  }

  private async handleSendPushNotification(
    job: Job<ISendPushNotificationJobData, void, EJobName>,
  ): Promise<void> {
    const { recipientId, title, body, data } = job.data;
    try {
      const fcmTokens: string[] = await lastValueFrom(
        this.userClient.send(USER_MESSAGE_PATTERNS.GET_USER_FCM_TOKENS, {
          userId: recipientId,
        }),
      );

      if (fcmTokens && fcmTokens.length > 0) {
        await this.fcmService.sendPushNotification(
          fcmTokens,
          title,
          body,
          data,
        );
      }
    } catch (error) {
      this.logger.error(
        `Failed to process background push notification: ${error.message}`,
      );
      throw error;
    }
  }
}
