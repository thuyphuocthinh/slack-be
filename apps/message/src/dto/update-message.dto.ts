import { IsArray, IsDefined, IsNotEmpty, IsOptional } from 'class-validator';
import { IMessageAttachment } from '../types/message-attachment.interface';
import { IToolCallTrace } from '../types/tool-call-trace.interface';

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

  // Chỉ orchestration (AI) truyền field này khi update message của bot.
  @IsArray()
  @IsOptional()
  toolCalls?: IToolCallTrace[];

  @IsOptional()
  executionTimeMs?: number;
}
