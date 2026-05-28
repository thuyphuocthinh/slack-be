import { IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class CreateWebhookDto {
  @IsUUID()
  @IsNotEmpty()
  channelId: string;

  @IsUUID()
  @IsNotEmpty()
  workspaceId: string;

  @IsUUID()
  @IsNotEmpty()
  userId: string; // The person creating it

  @IsString()
  @IsOptional()
  @MaxLength(128)
  name?: string;

  @IsString()
  @IsOptional()
  @MaxLength(255)
  description?: string;

  @IsString()
  @IsOptional()
  avatarUrl?: string;
}

export class UpdateWebhookDto {
  @IsUUID()
  @IsNotEmpty()
  webhookId: string;

  @IsUUID()
  @IsNotEmpty()
  channelId: string;

  @IsUUID()
  @IsNotEmpty()
  userId: string;

  @IsString()
  @IsOptional()
  @MaxLength(128)
  name?: string;

  @IsString()
  @IsOptional()
  @MaxLength(255)
  description?: string;

  @IsString()
  @IsOptional()
  avatarUrl?: string;
}

export class GetWebhooksDto {
  @IsUUID()
  @IsNotEmpty()
  channelId: string;

  @IsUUID()
  @IsNotEmpty()
  userId: string;
}

export class DeleteWebhookDto {
  @IsUUID()
  @IsNotEmpty()
  webhookId: string;

  @IsUUID()
  @IsNotEmpty()
  channelId: string;

  @IsUUID()
  @IsNotEmpty()
  userId: string;
}

export class WebhookResponseDto {
  id: string;
  channelId: string;
  workspaceId: string;
  createdBy: string;
  name: string;
  description: string;
  avatarUrl: string;
  token: string;
  createdAt: Date;
  updatedAt: Date;
}
