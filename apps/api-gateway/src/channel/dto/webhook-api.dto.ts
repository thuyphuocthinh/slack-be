import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateWebhookApiDto {
  @ApiPropertyOptional({ description: 'Tên hiển thị của Webhook Bot' })
  @IsString()
  @IsOptional()
  @MaxLength(128)
  name?: string;

  @ApiPropertyOptional({ description: 'Mô tả ngắn gọn về Webhook' })
  @IsString()
  @IsOptional()
  @MaxLength(255)
  description?: string;

  @ApiPropertyOptional({ description: 'URL Avatar của Webhook Bot' })
  @IsString()
  @IsOptional()
  avatarUrl?: string;

  @ApiPropertyOptional({ description: 'Loại Webhook (custom, github, trello...)' })
  @IsString()
  @IsOptional()
  appType?: string;
}

export class UpdateWebhookApiDto {
  @ApiPropertyOptional({ description: 'Tên hiển thị của Webhook Bot' })
  @IsString()
  @IsOptional()
  @MaxLength(128)
  name?: string;

  @ApiPropertyOptional({ description: 'Mô tả ngắn gọn về Webhook' })
  @IsString()
  @IsOptional()
  @MaxLength(255)
  description?: string;

  @ApiPropertyOptional({ description: 'URL Avatar của Webhook Bot' })
  @IsString()
  @IsOptional()
  avatarUrl?: string;

  @ApiPropertyOptional({ description: 'Loại Webhook (custom, github, trello...)' })
  @IsString()
  @IsOptional()
  appType?: string;
}
