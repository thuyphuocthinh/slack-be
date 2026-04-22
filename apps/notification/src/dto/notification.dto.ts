import {
  IsString,
  IsNotEmpty,
  IsEnum,
  IsOptional,
  IsObject,
  IsUUID,
  IsNumber,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  NotificationType,
  NotificationStatus,
} from '../types/notification.type';

import {
  NOTIFICATION_TEMPLATE_KEYS,
  type NotificationTemplateKey,
} from '../constants/notification.const';

export class FetchNotificationsDto {
  @IsUUID()
  userId: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  limit?: number = 20;

  @IsOptional()
  @IsEnum(NotificationStatus)
  status?: NotificationStatus;
}

export class PushNotificationDto {
  @IsUUID()
  recipientId: string;

  @IsEnum(NotificationType)
  type: NotificationType;

  @IsEnum(NOTIFICATION_TEMPLATE_KEYS)
  templateKey: NotificationTemplateKey;

  @IsString()
  @IsOptional()
  content?: string;

  @IsString()
  @IsNotEmpty()
  objectId: string;

  @IsString()
  @IsNotEmpty()
  objectType: string;

  @IsObject()
  @IsOptional()
  metadata?: Record<string, any>;
}

export class MarkNotificationDto {
  @IsUUID()
  userId: string;

  @IsUUID()
  id: string;
}

export class MarkAllAsReadDto {
  @IsUUID()
  userId: string;

  @IsUUID()
  @IsOptional()
  workspaceId?: string; // Optional filter if marking all by workspace
}

export class DeleteNotificationDto {
  @IsUUID()
  userId: string;

  @IsUUID()
  id: string;
}
