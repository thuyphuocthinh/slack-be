import {
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsUUID,
  Min,
} from 'class-validator';

// Không cho đổi `type` ở đây (Heading -> Todo không phải "edit" thông thường) và
// không có `pageId` (chuyển block sang page khác không phải use case này).
export class UpdateBlockDto {
  @IsUUID()
  @IsNotEmpty()
  id: string;

  @IsUUID()
  @IsNotEmpty()
  userId: string; // caller — check quyền Edit

  @IsOptional()
  @IsObject()
  content?: Record<string, unknown>;

  @IsOptional()
  @IsInt()
  @Min(0)
  order?: number; // đổi order = kéo-thả sắp xếp lại

  @IsOptional()
  @IsUUID()
  parentId?: string; // đổi block cha = thay đổi mức nest (indent/outdent)
}
