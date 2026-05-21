import {
  IsArray,
  IsDefined,
  IsNotEmpty,
  IsOptional,
  IsUUID,
  ValidateIf,
} from 'class-validator';
import { IMessageAttachment } from '../types/message-attachment.interface';

export class CreateMessageDto {
  @IsUUID()
  @IsNotEmpty()
  channelId: string;

  @ValidateIf((o) => !o.attachments || o.attachments.length === 0)
  @IsNotEmpty({ message: 'Content is required when there are no attachments' })
  content: string | Record<string, unknown> | Record<string, unknown>[];

  @IsArray()
  @IsOptional()
  attachments?: IMessageAttachment[];

  @IsArray()
  @IsOptional()
  mentions?: string[];

  @IsUUID()
  @IsOptional()
  parentId?: string;

  @IsUUID()
  @IsNotEmpty()
  senderId: string;
}
