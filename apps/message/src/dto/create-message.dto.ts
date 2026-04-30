import { IsArray, IsDefined, IsNotEmpty, IsOptional, IsUUID } from 'class-validator';

export class CreateMessageDto {
  @IsUUID()
  @IsNotEmpty()
  channelId: string;

  @IsDefined()
  @IsNotEmpty()
  content: string | Record<string, unknown>[];

  @IsArray()
  @IsUUID('all', { each: true })
  @IsOptional()
  mentions?: string[];

  @IsUUID()
  @IsOptional()
  parentId?: string;

  @IsUUID()
  @IsNotEmpty()
  senderId: string;
}
