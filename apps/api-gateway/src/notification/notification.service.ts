import { Inject, Injectable } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import {
  NAME_SERVICE_TCP,
  NOTIFICATION_MESSAGE_PATTERNS,
} from '@slack/constants';
import { firstValueFrom } from 'rxjs';
import { FetchNotificationsDto } from './dto';

@Injectable()
export class NotificationService {
  constructor(
    @Inject(NAME_SERVICE_TCP.NOTIFICATION_SERVICE)
    private readonly notificationClient: ClientProxy,
  ) {}

  async getUnreadSummary(userId: string) {
    return await firstValueFrom(
      this.notificationClient.send(
        NOTIFICATION_MESSAGE_PATTERNS.GET_UNREAD_SUMMARY,
        { userId },
      ),
    );
  }

  async fetchNotifications(userId: string, dto: FetchNotificationsDto) {
    return await firstValueFrom(
      this.notificationClient.send(
        NOTIFICATION_MESSAGE_PATTERNS.FETCH_NOTIFICATIONS,
        {
          ...dto,
          userId,
        },
      ),
    );
  }

  async markAsRead(userId: string, id: string) {
    return await firstValueFrom(
      this.notificationClient.send(NOTIFICATION_MESSAGE_PATTERNS.MARK_AS_READ, {
        userId,
        id,
      }),
    );
  }

  async markAllAsRead(userId: string, workspaceId?: string) {
    return await firstValueFrom(
      this.notificationClient.send(
        NOTIFICATION_MESSAGE_PATTERNS.MARK_ALL_AS_READ,
        {
          userId,
          workspaceId,
        },
      ),
    );
  }

  async deleteNotification(userId: string, id: string) {
    return await firstValueFrom(
      this.notificationClient.send(
        NOTIFICATION_MESSAGE_PATTERNS.DELETE_NOTIFICATION,
        {
          userId,
          id,
        },
      ),
    );
  }
}
