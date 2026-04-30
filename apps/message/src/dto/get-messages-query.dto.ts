import { IsInt, IsOptional, IsUUID, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class GetMessagesQueryDto {
  @IsUUID()
  @IsOptional()
  channelId?: string;

  @IsUUID()
  @IsOptional()
  parentId?: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  limit?: number = 20;

  @IsUUID()
  @IsOptional()
  cursor?: string; // For cursor-based pagination (using message id)
}
