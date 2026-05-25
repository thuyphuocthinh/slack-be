import { IsArray, IsDefined, IsNotEmpty, IsOptional } from 'class-validator';
import { IMessageAttachment } from '../types/message-attachment.interface';

export class UpdateMessageDto {
  @IsDefined()
  @IsNotEmpty()
  content: string | Record<string, unknown> | Record<string, unknown>[];

  @IsArray()
  @IsOptional()
  attachments?: IMessageAttachment[];

  @IsArray()
  @IsOptional()
  mentions?: string[];
}
