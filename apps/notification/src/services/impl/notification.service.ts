import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Notification } from '../../entity/notification.entity';
import { ClientProxy, RpcException } from '@nestjs/microservices';
import {
  NAME_SERVICE_TCP,
  NOTIFICATION_ERROR,
  USER_MESSAGE_PATTERNS,
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
import { NotificationStatus } from '../../types/notification.type';
import { NotificationResponse } from '../../types/notification.response';

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    @InjectRepository(Notification)
    private readonly notificationRepo: Repository<Notification>,
    @Inject(NAME_SERVICE_TCP.USER_SERVICE)
    private readonly userClient: ClientProxy,
  ) {}

  async fetchNotifications(
    dto: FetchNotificationsDto,
  ): Promise<IOffsetResponse<NotificationResponse[]>> {
    const { userId, page = 1, limit = 20, status } = dto;
    const skip = (page - 1) * limit;

    const query = this.notificationRepo
      .createQueryBuilder('notification')
      .where('notification.recipientId = :userId', { userId });

    if (status) {
      query.andWhere('notification.status = :status', { status });
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
      status: NotificationStatus.UNREAD,
    });

    const saved = await this.notificationRepo.save(notification);

    // CHÚ THÍCH:
    // Chỗ này (nếu cần) sẽ gọi API/Gateway để emit qua Socket.io thông báo message mới tới user.
    // Hiện tại chỉ implement service thuần, không dùng socket.
    // flow: client -> gateway (either SOCKET | HTTPS) -> CHAT | TASK ... -> REDIS | QUEUE  -> notification service -> save notification -> gateway (SOCKET) -> client

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
      // query.andWhere("metadata->>'workspaceId' = :workspaceId", { workspaceId });
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
}
