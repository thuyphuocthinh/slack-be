import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
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

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    @InjectRepository(Notification)
    private readonly notificationRepo: Repository<Notification>,
    @Inject(NAME_SERVICE_TCP.USER_SERVICE)
    private readonly userClient: ClientProxy,
    private readonly queueService: QueueService,
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

  async pushNotification(dto: PushNotificationDto): Promise<Notification | null> {
    // 1. Kiểm tra cấu hình preferences của User
    await this.checkUserPreference(dto.recipientId);

    // 2. Validate Metadata
    const validatedMetadata = this.validateMetadata(dto.templateKey || dto.type, dto.metadata);

    // 3. Lưu thông báo vào database — ON CONFLICT DO NOTHING (unique
    // recipientId+objectId, notification.md mục 4.2) chặn BullMQ retry
    // (attempts:3, queue.module.ts) tạo trùng khi job fail giữa chừng rồi
    // chạy lại từ đầu.
    const saved = await this.saveNotificationEntity(dto, validatedMetadata);
    if (!saved) {
      this.logger.debug(
        `pushNotification() bỏ qua — đã tồn tại (retry) recipientId=${dto.recipientId} objectId=${dto.objectId}`,
      );
      return null;
    }

    // 4. Kích hoạt các Side-effects (Socket & FCM Push) chạy nền song song
    this.triggerNotificationSideEffects(saved);

    return saved;
  }

  // notification.md — "gộp INSERT thành 1 câu multi-row" thay vì N lần
  // pushNotification() riêng lẻ trong 1 lô của notification.processor.ts.
  // Giảm hẳn số round-trip + CPU work thật Postgres phải làm (1 câu INSERT
  // nhiều VALUES thay vì N câu), không chỉ giảm concurrency phía ứng dụng.
  async pushNotificationsBatch(dtos: PushNotificationDto[]): Promise<Notification[]> {
    if (dtos.length === 0) return [];

    // Giữ nguyên hành vi checkUserPreference() như pushNotification() đơn lẻ.
    await Promise.all(dtos.map((dto) => this.checkUserPreference(dto.recipientId)));

    const rows = dtos.map((dto) => ({
      recipientId: dto.recipientId,
      type: dto.type,
      templateKey: dto.templateKey || dto.type,
      content: dto.content,
      objectId: dto.objectId,
      objectType: dto.objectType,
      metadata: this.validateMetadata(dto.templateKey || dto.type, dto.metadata),
      workspaceId: dto.workspaceId,
      status: NotificationStatus.UNREAD,
    }));

    // ON CONFLICT DO NOTHING (UQ_notifications_recipient_object) — bảo vệ
    // idempotent y hệt pushNotification() đơn lẻ, RETURNING chỉ trả về đúng
    // những row THẬT SỰ mới insert (row bị bỏ qua không xuất hiện ở đây).
    const insertResult = await this.notificationRepo
      .createQueryBuilder()
      .insert()
      .into(Notification)
      .values(rows)
      .orIgnore()
      .returning(['id'])
      .execute();

    if (insertResult.raw.length === 0) return [];

    const insertedIds = insertResult.raw.map((r: { id: string }) => r.id);
    const saved = await this.notificationRepo.findBy({ id: In(insertedIds) });

    // Side-effects CHỈ cho recipient thật sự mới — recipient bị DO NOTHING
    // bỏ qua (đã tồn tại/retry) không nằm trong `saved`, không bắn socket/FCM trùng.
    await Promise.all(saved.map((n) => this.triggerNotificationSideEffects(n)));

    return saved;
  }

  private async checkUserPreference(userId: string): Promise<void> {
    try {
      const preferences = await lastValueFrom(
        this.userClient.send(USER_MESSAGE_PATTERNS.GET_USER_PREFERENCE, {
          userId,
        }),
      );

      if (!preferences) {
        this.logger.debug(`Could not find preferences for user ${userId}`);
      }
    } catch (error) {
      this.logger.warn(`Failed to fetch user preferences: ${error.message}`);
    }
  }

  private validateMetadata(templateKey: string, metadata: any): any {
    const schema = NotificationMetadataSchema[templateKey];
    if (!schema) return metadata;

    try {
      return schema.parse(metadata || {});
    } catch (error) {
      this.logger.warn(`Invalid metadata for template ${templateKey}: ${error.message}`);
      throw new RpcException(`Invalid metadata for template ${templateKey}`);
    }
  }

  private async saveNotificationEntity(dto: PushNotificationDto, metadata: any): Promise<Notification | null> {
    const insertResult = await this.notificationRepo
      .createQueryBuilder()
      .insert()
      .into(Notification)
      .values({
        recipientId: dto.recipientId,
        type: dto.type,
        templateKey: dto.templateKey || dto.type,
        content: dto.content,
        objectId: dto.objectId,
        objectType: dto.objectType,
        metadata,
        workspaceId: dto.workspaceId,
        status: NotificationStatus.UNREAD,
      })
      .orIgnore()
      .returning(['id'])
      .execute();

    if (insertResult.raw.length === 0) {
      return null; // UQ_notifications_recipient_object đã có sẵn — bị DO NOTHING bỏ qua
    }

    return this.notificationRepo.findOneBy({ id: insertResult.raw[0].id });
  }

  private async triggerNotificationSideEffects(saved: Notification): Promise<void> {
    try {
      await Promise.all([
        this.emitSocketUpdate(saved),
        this.enqueueFcmPush(saved),
      ]);
    } catch (error) {
      this.logger.error(`Error in notification side effects: ${error.message}`);
    }
  }

  private async emitSocketUpdate(saved: Notification): Promise<void> {
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
  }

  private async enqueueFcmPush(saved: Notification): Promise<void> {
    try {
      // Gửi Firebase Push cho tất cả các loại thông báo quan trọng (bao gồm Chat, Task, Calendar)
      // Để user nhận được thông báo Native OS khi họ đang offline (chưa mở app)
      const allowedFcmTypes = [
        NotificationType.MESSAGE_RECEIVED,
        NotificationType.MENTIONED_IN_MESSAGE,
        NotificationType.REPLY_IN_THREAD,
        NotificationType.CALENDAR_REQUEST_CREATED,
        NotificationType.CALENDAR_REQUEST_APPROVED,
        NotificationType.CALENDAR_REQUEST_REJECTED,
        NotificationType.TASK_ASSIGNED,
        NotificationType.TASK_DUE_SOON,
      ];

      if (!allowedFcmTypes.includes(saved.type)) {
        return;
      }

      const actorName = String(saved.metadata?.['actorName'] || 'Slack Clone');
      const channelName = saved.metadata?.['channelName']
        ? `#${String(saved.metadata['channelName'])}`
        : '';
      const title = channelName ? `${actorName} (trong ${channelName})` : actorName;
      const body = this.extractPlainHistoryText(saved.content || '');

      const notificationData: Record<string, string> = {
        workspaceId: saved.workspaceId || '',
        channelId: String(saved.metadata?.['channelId'] || ''),
        messageId: saved.objectId || '',
      };

      await this.queueService.addJob(
        EQueueName.NOTIFICATION_QUEUE,
        EJobName.SEND_PUSH_NOTIFICATION,
        {
          recipientId: saved.recipientId,
          title,
          body,
          data: notificationData,
        },
      );
    } catch (error) {
      this.logger.error(`Không thể xếp hàng gửi push notification qua FCM: ${error.message}`);
    }
  }

  private extractPlainHistoryText(contentStr: string): string {
    try {
      const parsed = JSON.parse(contentStr);

      if (typeof parsed === 'string') {
        return parsed;
      }

      // Xử lý đệ quy trích xuất text từ cấu trúc Rich Content JSON (Tiptap / Lexical)
      const texts: string[] = [];
      const traverse = (node: any) => {
        if (!node) return;
        if (node.type === 'text' && typeof node.text === 'string') {
          texts.push(node.text);
        }
        if (Array.isArray(node.content)) {
          node.content.forEach(traverse);
        }
      };

      traverse(parsed);
      return texts.join(' ');
    } catch {
      return contentStr;
    }
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

