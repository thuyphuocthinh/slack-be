import {
  IsString,
  IsNotEmpty,
  IsEnum,
  IsOptional,
  IsObject,
  IsUUID,
  IsNumber,
  Min,
  IsArray,
} from 'class-validator';
import { Type, Transform } from 'class-transformer';
import { NotificationType, NotificationStatus } from '@slack/constants';

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

  @IsOptional()
  @IsEnum(NotificationType)
  type?: NotificationType;

  @IsOptional()
  @Transform(({ value }) => (Array.isArray(value) ? value : [value]))
  @IsArray()
  @IsEnum(NotificationType, { each: true })
  types?: NotificationType[];

  @IsOptional()
  @IsUUID()
  workspaceId?: string;
}

export class PushNotificationDto {
  @IsUUID()
  recipientId: string;

  @IsEnum(NotificationType)
  type: NotificationType;

  @IsEnum(NotificationType)
  templateKey: NotificationType;

  @IsString()
  @IsOptional()
  content?: string;

  @IsString()
  @IsNotEmpty()
  objectId: string;

  @IsString()
  @IsNotEmpty()
  objectType: string;

  @IsString()
  @IsNotEmpty()
  dedupeKey: string;

  @IsObject()
  @IsOptional()
  metadata?: Record<string, any>;

  @IsUUID()
  @IsOptional()
  workspaceId?: string;
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
  workspaceId?: string;
}

export class DeleteNotificationDto {
  @IsUUID()
  userId: string;

  @IsUUID()
  id: string;
}
