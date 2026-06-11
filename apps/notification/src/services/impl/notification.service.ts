import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Notification } from '../../entity/notification.entity';
import { ClientProxy, RpcException } from '@nestjs/microservices';
import {
  NAME_SERVICE_TCP,
  NOTIFICATION_ERROR,
  USER_MESSAGE_PATTERNS,
  ESocketEvent,
  NotificationType,
} from '@slack/constants';
import { IOffsetResponse } from '@slack/common';
import { lastValueFrom } from 'rxjs';
import { NotificationMetadataSchema } from '../../constants/metadata_schema.const';
import {
  FetchNotificationsDto,
  PushNotificationDto,
  MarkNotificationDto,
  MarkAllAsReadDto,
  DeleteNotificationDto,
} from '../../dto';
import { NotificationStatus } from '@slack/constants';
import { NotificationResponse } from '../../types/notification.response';
import { NotificationUnreadSummaryResponse } from '../../types/notification-unread-summary.response';
import { QueueService, EQueueName, EJobName } from '@slack/queue';
import { FcmService } from './fcm.service';

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    @InjectRepository(Notification)
    private readonly notificationRepo: Repository<Notification>,
    @Inject(NAME_SERVICE_TCP.USER_SERVICE)
    private readonly userClient: ClientProxy,
    private readonly queueService: QueueService,
    private readonly fcmService: FcmService,
  ) { }

  async fetchNotifications(
    dto: FetchNotificationsDto,
  ): Promise<IOffsetResponse<NotificationResponse[]>> {
    const { userId, page = 1, limit = 20, status, type, types, workspaceId } = dto;
    const skip = (page - 1) * limit;

    const query = this.notificationRepo
      .createQueryBuilder('notification')
      .where('notification.recipientId = :userId', { userId });

    if (status) {
      query.andWhere('notification.status = :status', { status });
    }

    if (workspaceId) {
      query.andWhere('notification.workspaceId = :workspaceId', { workspaceId });
    }

    if (type) {
      query.andWhere('notification.type = :type', { type });
    } else if (types && types.length > 0) {
      query.andWhere('notification.type IN (:...types)', { types });
    }

    query.orderBy('notification.createdAt', 'DESC');
    query.skip(skip).take(limit);

    const [items, total] = await query.getManyAndCount();

    const responseData: NotificationResponse[] = items.map((item) => ({
      ...item,
    }));

    return {
      data: responseData,
      paging: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    } as unknown as IOffsetResponse<NotificationResponse[]>;
  }

  async pushNotification(dto: PushNotificationDto) {
    // Lấy user preferences từ user service
    try {
      const preferences = await lastValueFrom(
        this.userClient.send(USER_MESSAGE_PATTERNS.GET_USER_PREFERENCE, {
          userId: dto.recipientId,
        }),
      );

      // Ở đây tạm thời check nếu có preferences trả về, sau này update logic check filter cho từng notification type sau.
      // VD: if (preferences && preferences.someSetting === false) return null;
      if (!preferences) {
        this.logger.debug(
          `Could not find preferences for user ${dto.recipientId}`,
        );
      }
    } catch (error) {
      this.logger.warn(`Failed to fetch user preferences: ${error.message}`);
    }

    // Validate metadata
    const schema = NotificationMetadataSchema[dto.templateKey];
    if (schema) {
      try {
        dto.metadata = schema.parse(dto.metadata || {});
      } catch (error) {
        this.logger.warn(
          `Invalid metadata for template ${dto.templateKey}: ${error.message}`,
        );
        throw new RpcException(
          `Invalid metadata for template ${dto.templateKey}`,
        );
      }
    }

    const notification = this.notificationRepo.create({
      recipientId: dto.recipientId,
      type: dto.type,
      templateKey: dto.templateKey || dto.type,
      content: dto.content,
      objectId: dto.objectId,
      objectType: dto.objectType,
      metadata: dto.metadata,
      workspaceId: dto.workspaceId,
      status: NotificationStatus.UNREAD,
    });

    const saved = await this.notificationRepo.save(notification);

    // Bắn tin hiệu Socket Realtime tới Room cá nhân của User đó
    // Đưa vào try-catch để nếu socket lỗi cũng không làm fail transaction chính
    try {
      const unreadNotiCount = await this.getUnreadCount(saved.recipientId);
      const unreadSummary = await this.getUnreadSummary(saved.recipientId);
      await this.queueService.addJob(
        EQueueName.SOCKET_QUEUE,
        EJobName.EMIT_EVENT,
        {
          event: ESocketEvent.UNREAD_ACTIVITY_COUNT_UPDATED,
          room: `user_${saved.recipientId}`,
          data: {
            ...saved,
            unreadNotiCount,
            unreadSummary,
          },
        },
      );
    } catch (error) {
      this.logger.error(`Failed to emit socket event: ${error.message}`);
    }

    // Gửi thông báo đẩy qua Firebase Cloud Messaging (FCM)
    try {
      const fcmTokens: string[] = await lastValueFrom(
        this.userClient.send(USER_MESSAGE_PATTERNS.GET_USER_FCM_TOKENS, {
          userId: saved.recipientId,
        }),
      );

      if (fcmTokens && fcmTokens.length > 0) {
        const actorName = String(saved.metadata?.['actorName'] || 'Slack Clone');
        const channelName = saved.metadata?.['channelName']
          ? `#${String(saved.metadata['channelName'])}`
          : '';
        const title = channelName ? `${actorName} (trong ${channelName})` : actorName;
        const body = saved.content || '';

        const notificationData: Record<string, string> = {
          workspaceId: saved.workspaceId || '',
          channelId: String(saved.metadata?.['channelId'] || ''),
          messageId: saved.objectId || '',
        };

        await this.fcmService.sendPushNotification(
          fcmTokens,
          title,
          body,
          notificationData,
        );
      }
    } catch (error) {
      this.logger.error(`Không thể gửi push notification qua FCM: ${error.message}`);
    }

    return saved;
  }

  async markAsRead(dto: MarkNotificationDto): Promise<string> {
    const { id, userId } = dto;
    const result = await this.notificationRepo.update(
      { id, recipientId: userId },
      { status: NotificationStatus.READ },
    );

    if (result.affected === 0) {
      throw new RpcException(NOTIFICATION_ERROR.NOTIFICATION_NOT_FOUND);
    }

    return 'Mark notification as read successfully';
  }

  async markAllAsRead(dto: MarkAllAsReadDto): Promise<string> {
    const { userId, workspaceId } = dto;
    const query = this.notificationRepo
      .createQueryBuilder()
      .update(Notification)
      .set({ status: NotificationStatus.READ })
      .where('recipientId = :userId', { userId })
      .andWhere('status = :status', { status: NotificationStatus.UNREAD });

    if (workspaceId) {
      query.andWhere('workspaceId = :workspaceId', { workspaceId });
    }

    await query.execute();
    return 'Mark all as read successfully';
  }

  async deleteNotification(dto: DeleteNotificationDto): Promise<string> {
    const { id, userId } = dto;
    const result = await this.notificationRepo.delete({
      id,
      recipientId: userId,
    });

    if (result.affected === 0) {
      throw new RpcException(NOTIFICATION_ERROR.NOTIFICATION_NOT_FOUND);
    }

    return 'Delete notification successfully';
  }

  async getUnreadCount(userId: string): Promise<number> {
    return this.notificationRepo.count({
      where: { recipientId: userId, status: NotificationStatus.UNREAD },
    });
  }

  async getUnreadSummary(
    userId: string,
    workspaceId?: string,
  ): Promise<NotificationUnreadSummaryResponse> {
    const query = this.notificationRepo
      .createQueryBuilder('notification')
      .select('notification.type', 'type')
      .addSelect('COUNT(*)', 'count')
      .where('notification.recipient_id = :userId', { userId })
      .andWhere('notification.status = :status', {
        status: NotificationStatus.UNREAD,
      });

    if (workspaceId) {
      query.andWhere('notification.workspace_id = :workspaceId', { workspaceId });
    }

    const rawCounts = await query.groupBy('notification.type').getRawMany();

    const summary: NotificationUnreadSummaryResponse = {
      unreadAll: 0,
      unreadMention: 0,
      unreadReaction: 0,
      unreadSystem: 0,
      unreadTask: 0,
    };

    rawCounts.forEach((rc) => {
      const count = parseInt(rc.count, 10);
      summary.unreadAll += count;

      switch (rc.type) {
        case NotificationType.MENTIONED_IN_MESSAGE:
        case NotificationType.MESSAGE_RECEIVED:
        case NotificationType.REPLY_IN_THREAD:
          summary.unreadMention += count;
          break;
        case NotificationType.MESSAGE_REACTION_ADDED:
          summary.unreadReaction += count;
          break;
        case NotificationType.TASK_ASSIGNED:
        case NotificationType.TASK_UPDATED:
        case NotificationType.TASK_DUE_SOON:
          summary.unreadTask += count;
          break;
        default:
          // channel, workspace, system
          summary.unreadSystem += count;
          break;
      }
    });

    return summary;
  }

  async getNotificationById(id: string, userId: string): Promise<NotificationResponse> {
    const notification = await this.notificationRepo.findOne({
      where: { id, recipientId: userId },
    });

    if (!notification) {
      throw new RpcException(NOTIFICATION_ERROR.NOTIFICATION_NOT_FOUND);
    }

    return notification as NotificationResponse;
  }
}

