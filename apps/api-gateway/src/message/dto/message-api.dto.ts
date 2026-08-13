import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  Max,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { IsNotHtmlXss } from '../../common/decorators/is-not-xss.decorator';

export class MessageAttachmentApiDto {
  @IsUUID()
  @IsNotEmpty()
  @ApiProperty()
  id: string;

  @IsString()
  @IsNotEmpty()
  @ApiProperty()
  publicId: string;

  @IsString()
  @IsNotEmpty()
  @ApiProperty()
  url: string;

  @IsString()
  @IsNotEmpty()
  @ApiProperty()
  filename: string;

  @IsString()
  @IsNotEmpty()
  @ApiProperty()
  mimeType: string;

  @IsInt()
  @IsNotEmpty()
  @ApiProperty()
  size: number;

  @IsString()
  @IsNotEmpty()
  @ApiProperty()
  type: string;

  @IsString()
  @IsOptional()
  @ApiPropertyOptional()
  thumbnailUrl?: string;
}

export class CreateMessageApiDto {
  @ValidateIf((o) => !o.attachments || o.attachments.length === 0)
  @IsNotEmpty({ message: 'Content is required when there are no attachments' })
  @IsNotHtmlXss({ message: 'Content contains dangerous HTML/XSS payloads' })
  @ApiProperty()
  content: string | Record<string, unknown> | Record<string, unknown>[];

  @IsArray()
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => MessageAttachmentApiDto)
  @ApiPropertyOptional({ type: [MessageAttachmentApiDto] })
  attachments?: MessageAttachmentApiDto[];

  @IsArray()
  @IsOptional()
  @ApiPropertyOptional()
  mentions?: string[];

  @IsUUID()
  @IsOptional()
  @ApiPropertyOptional()
  parentId?: string;
}

export class UpdateMessageApiDto {
  @IsNotEmpty()
  @IsNotHtmlXss({ message: 'Content contains dangerous HTML/XSS payloads' })
  @ApiProperty()
  content: string | Record<string, unknown> | Record<string, unknown>[];

  @IsArray()
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => MessageAttachmentApiDto)
  @ApiPropertyOptional({ type: [MessageAttachmentApiDto] })
  attachments?: MessageAttachmentApiDto[];

  @IsArray()
  @IsOptional()
  @ApiPropertyOptional()
  mentions?: string[];
}

export class GetMessagesQueryApiDto {
  @IsUUID()
  @IsOptional()
  @ApiPropertyOptional()
  parentId?: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  @IsOptional()
  @ApiPropertyOptional({ default: 20 })
  limit?: number = 20;

  @IsString()
  @IsOptional()
  @ApiPropertyOptional()
  cursor?: string;

  @IsString()
  @IsOptional()
  @ApiPropertyOptional({ enum: ['before', 'after'], default: 'before' })
  direction?: 'before' | 'after' = 'before';
}

export class ToggleReactionApiDto {
  @IsString()
  @IsNotEmpty()
  @ApiProperty()
  emoji: string;
}

export class ToggleFeedbackApiDto {
  @IsIn(['like', 'unlike'])
  @IsNotEmpty()
  @ApiProperty({ enum: ['like', 'unlike'] })
  type: 'like' | 'unlike';
}

export class SearchMessagesQueryApiDto {
  @IsString()
  @IsNotEmpty()
  @ApiProperty()
  keyword: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  @ApiPropertyOptional({ default: 20 })
  limit?: number = 20;

  @IsString()
  @IsOptional()
  @ApiPropertyOptional()
  cursor?: string;
}

export class GetThreadQueryApiDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  @ApiPropertyOptional({ default: 10 })
  limit?: number = 10;

  @IsString()
  @IsOptional()
  @ApiPropertyOptional()
  cursor?: string;
}

export class GetFullThreadQueryApiDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  @ApiPropertyOptional({ default: 10 })
  limit?: number = 10;

  @IsString()
  @IsOptional()
  @ApiPropertyOptional()
  cursor?: string;
}

export class GetPinnedMessagesQueryApiDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  @ApiPropertyOptional({ default: 20 })
  limit?: number = 20;

  @IsString()
  @IsOptional()
  @ApiPropertyOptional()
  cursor?: string;
}

export class GetSurroundingMessagesQueryApiDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  @ApiPropertyOptional({ default: 30 })
  limit?: number = 30;
}

export class GetAttachmentsQueryApiDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  @ApiPropertyOptional({ default: 1 })
  page?: number = 1;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  @ApiPropertyOptional({ default: 20 })
  limit?: number = 20;

  @IsString()
  @IsOptional()
  @ApiPropertyOptional()
  mimeType?: string;
}
