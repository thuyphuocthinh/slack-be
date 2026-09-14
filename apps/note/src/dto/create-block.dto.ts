import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsUUID,
  Min,
} from 'class-validator';
import { BlockType } from '../types/blocks.types';

export class CreateBlockDto {
  @IsUUID()
  @IsNotEmpty()
  pageId: string;

  @IsUUID()
  @IsNotEmpty()
  userId: string; // caller — check quyền Edit trước khi tạo

  @IsEnum(BlockType)
  @IsNotEmpty()
  type: BlockType;

  @IsObject()
  @IsNotEmpty()
  content: Record<string, unknown>; // shape khác nhau theo type (Todo: checked, Image: url...)

  @IsInt()
  @Min(0)
  order: number;

  @IsOptional()
  @IsUUID()
  parentId?: string; // block CHA để nest (khác pageId) — VD nằm trong 1 Toggle
}
