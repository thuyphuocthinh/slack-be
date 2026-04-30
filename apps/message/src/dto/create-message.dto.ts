import { IsDefined, IsNotEmpty, IsOptional, IsString, IsUUID } from 'class-validator';

export class CreateMessageDto {
  @IsUUID()
  @IsNotEmpty()
  channelId: string;

  @IsDefined()
  @IsNotEmpty()
  content: string | Record<string, unknown>[];

  @IsUUID()
  @IsOptional()
  parentId?: string;

  @IsUUID()
  @IsNotEmpty()
  userId: string;
}
