import {
  IsEnum,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';
import { ViewType } from '../types/views.types';

export class CreateViewDto {
  @IsUUID()
  @IsNotEmpty()
  pageId: string; // page Database (cha)

  @IsUUID()
  @IsNotEmpty()
  userId: string;

  @IsEnum(ViewType)
  @IsNotEmpty()
  type: ViewType;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>; // filter/sort/groupBy...
}
