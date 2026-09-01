import { Inject, Injectable } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import {
  NAME_SERVICE_TCP,
  NOTIFICATION_MESSAGE_PATTERNS,
} from '@slack/constants';
import { firstValueFrom } from 'rxjs';
import { MicroserviceErrorHandler } from '../common/microservice_error.handler';
import { FetchNotificationsDto } from './dto';

@Injectable()
export class NotificationService {
  constructor(
    @Inject(NAME_SERVICE_TCP.NOTIFICATION_SERVICE)
    private readonly notificationClient: ClientProxy,
  ) {}

  async getUnreadSummary(userId: string, workspaceId?: string) {
    return MicroserviceErrorHandler.handleAsyncCall(
      () =>
        firstValueFrom(
          this.notificationClient.send(
            NOTIFICATION_MESSAGE_PATTERNS.GET_UNREAD_SUMMARY,
            { userId, workspaceId },
          ),
        ),
      'getUnreadSummary',
      'NotificationService',
    );
  }

  async fetchNotifications(userId: string, dto: FetchNotificationsDto) {
    return MicroserviceErrorHandler.handleAsyncCall(
      () =>
        firstValueFrom(
          this.notificationClient.send(
            NOTIFICATION_MESSAGE_PATTERNS.FETCH_NOTIFICATIONS,
            {
              ...dto,
              userId,
            },
          ),
        ),
      'fetchNotifications',
      'NotificationService',
    );
  }

  async markAsRead(userId: string, id: string) {
    return MicroserviceErrorHandler.handleAsyncCall(
      () =>
        firstValueFrom(
          this.notificationClient.send(
            NOTIFICATION_MESSAGE_PATTERNS.MARK_AS_READ,
            {
              userId,
              id,
            },
          ),
        ),
      'markAsRead',
      'NotificationService',
    );
  }

  async markAllAsRead(userId: string, workspaceId?: string) {
    return MicroserviceErrorHandler.handleAsyncCall(
      () =>
        firstValueFrom(
          this.notificationClient.send(
            NOTIFICATION_MESSAGE_PATTERNS.MARK_ALL_AS_READ,
            {
              userId,
              workspaceId,
            },
          ),
        ),
      'markAllAsRead',
      'NotificationService',
    );
  }

  async deleteNotification(userId: string, id: string) {
    return MicroserviceErrorHandler.handleAsyncCall(
      () =>
        firstValueFrom(
          this.notificationClient.send(
            NOTIFICATION_MESSAGE_PATTERNS.DELETE_NOTIFICATION,
            {
              userId,
              id,
            },
          ),
        ),
      'deleteNotification',
      'NotificationService',
    );
  }

  async getNotificationById(userId: string, id: string) {
    return MicroserviceErrorHandler.handleAsyncCall(
      () =>
        firstValueFrom(
          this.notificationClient.send(
            NOTIFICATION_MESSAGE_PATTERNS.GET_NOTIFICATION_BY_ID,
            {
              userId,
              id,
            },
          ),
        ),
      'getNotificationById',
      'NotificationService',
    );
  }
}
