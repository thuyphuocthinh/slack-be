import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';
import { PropertyType } from '../types/properties.types';

// pageId ở đây là PAGE DATABASE (page cha) — quyền check ở CHA, không phải row
export class CreatePropertyDto {
  @IsUUID()
  @IsNotEmpty()
  pageId: string;

  @IsUUID()
  @IsNotEmpty()
  userId: string;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsEnum(PropertyType)
  @IsNotEmpty()
  type: PropertyType;

  @IsOptional()
  @IsObject()
  options?: Record<string, unknown>; // dùng cho Select (list lựa chọn...)

  @IsInt()
  @Min(0)
  order: number;
}
