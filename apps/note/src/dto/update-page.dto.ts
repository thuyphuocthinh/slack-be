import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

// Đổi parentId (move page) KHÔNG nằm ở đây — cần tính lại path/depth cho cả
// subtree, phức tạp hơn hẳn update field thường, nên tách endpoint riêng sau.
export class UpdatePageDto {
  @IsUUID()
  @IsNotEmpty()
  id: string;

  @IsUUID()
  @IsNotEmpty()
  userId: string; // caller — service check quyền Edit trước khi update

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
