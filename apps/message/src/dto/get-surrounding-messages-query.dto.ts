import { IsInt, IsNotEmpty, IsOptional, IsUUID, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class GetSurroundingMessagesQueryDto {
  @IsUUID()
  @IsNotEmpty()
  channelId: string;

  @IsUUID()
  @IsNotEmpty()
  userId: string;

  @IsUUID()
  @IsNotEmpty()
  targetMessageId: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  limit?: number = 30;
}
