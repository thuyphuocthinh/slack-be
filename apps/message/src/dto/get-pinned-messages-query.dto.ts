import { IsInt, IsNotEmpty, IsOptional, IsUUID, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class GetPinnedMessagesQueryDto {
  @IsUUID()
  @IsNotEmpty()
  channelId: string;

  @IsUUID()
  @IsNotEmpty()
  userId: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  limit?: number = 20;

  @IsUUID()
  @IsOptional()
  cursor?: string;
}
