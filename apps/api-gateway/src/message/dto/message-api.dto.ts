import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

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
  @ApiProperty()
  content: string | Record<string, unknown>[];

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
  @ApiProperty()
  content: string | Record<string, unknown>[];

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
  @IsOptional()
  @ApiPropertyOptional({ default: 20 })
  limit?: number = 20;

  @IsString()
  @IsOptional()
  @ApiPropertyOptional()
  cursor?: string;
}

export class ToggleReactionApiDto {
  @IsString()
  @IsNotEmpty()
  @ApiProperty()
  emoji: string;
}

export class SearchMessagesQueryApiDto {
  @IsString()
  @IsNotEmpty()
  @ApiProperty()
  keyword: string;
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

export class GetPinnedMessagesQueryApiDto {
  @IsUUID()
  @IsNotEmpty()
  @ApiProperty()
  channelId: string;

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
  @IsUUID()
  @IsNotEmpty()
  @ApiProperty()
  targetMessageId: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  @ApiPropertyOptional({ default: 30 })
  limit?: number = 30;
}
