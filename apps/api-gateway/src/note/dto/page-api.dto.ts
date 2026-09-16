import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
  MaxLength,
} from 'class-validator';

// type để dạng string, không @IsEnum(PageType) — validate nghiêm (PageType thật)
// nằm ở note microservice, tránh import enum xuyên app boundary từ api-gateway.
export class CreatePageApiDto {
  @IsOptional()
  @IsUUID()
  parentId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  title?: string;

  @IsOptional()
  @IsString()
  type?: string;

  @IsOptional()
  @IsBoolean()
  isPublic?: boolean;
}

export class UpdatePageApiDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  favicon?: string;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  coverImage?: string;

  @IsOptional()
  @IsBoolean()
  isPublic?: boolean;
}

// newParentId omit/null = chuyển thành trang gốc; newIndex omit = chèn cuối.
export class MovePageApiDto {
  @IsOptional()
  @IsUUID()
  newParentId?: string | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  newIndex?: number;
}

export class QueryPagesApiDto {
  @IsOptional()
  @IsUUID()
  parentId?: string;

  // Query param HTTP luôn là string ("true"/"false") — @IsBoolean() không tự
  // convert, phải @Transform tay trước khi validate.
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  rootOnly?: boolean;

  @IsOptional()
  @IsString()
  keyword?: string;

  @IsOptional()
  @IsString()
  createdFrom?: string;

  @IsOptional()
  @IsString()
  createdTo?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
