import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';

// 1 DTO chung cho list + search — filter nào không truyền thì bỏ qua, khớp pattern
// fetchNotifications (1 method, nhiều filter optional), không tách theo use case.
export class QueryPagesDto {
  @IsUUID()
  @IsNotEmpty()
  workspaceId: string;

  @IsUUID()
  @IsNotEmpty()
  userId: string; // caller — chỉ trả page user này xem được

  @IsOptional()
  @IsUUID()
  parentId?: string; // chỉ lấy con trực tiếp của page này

  @IsOptional()
  @IsBoolean()
  rootOnly?: boolean; // chỉ lấy page gốc (parentId IS NULL) — không dùng chung với parentId

  @IsOptional()
  @IsString()
  keyword?: string; // search theo title (ILIKE)

  @IsOptional()
  @IsDateString()
  createdFrom?: string;

  @IsOptional()
  @IsDateString()
  createdTo?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}
