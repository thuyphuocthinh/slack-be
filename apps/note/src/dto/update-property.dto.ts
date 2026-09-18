import {
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  IsEnum,
} from 'class-validator';
import { PropertyType } from '../types/properties.types';

// Cho phép đổi type, FE sẽ handle render an toàn nếu value cũ không match
export class UpdatePropertyDto {
  @IsUUID()
  @IsNotEmpty()
  id: string;

  @IsUUID()
  @IsNotEmpty()
  userId: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsEnum(PropertyType)
  type?: PropertyType;

  @IsOptional()
  @IsObject()
  options?: Record<string, unknown>;

  @IsOptional()
  @IsInt()
  @Min(0)
  order?: number;
}
