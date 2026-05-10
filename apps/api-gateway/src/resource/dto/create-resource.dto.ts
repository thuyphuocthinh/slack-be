import {
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
} from 'class-validator';
import { ResourceScope, ResourceType } from '../entity/resource.entity';

export class CreateResourceDto {
  @IsString()
  @IsNotEmpty()
  id: string;

  @IsString()
  @IsNotEmpty()
  filename: string;

  @IsString()
  @IsNotEmpty()
  publicId: string;

  @IsString()
  @IsNotEmpty()
  url: string;

  @IsEnum(ResourceScope)
  @IsNotEmpty()
  scope: ResourceScope;

  @IsString()
  @IsOptional()
  thumbnailUrl?: string;

  @IsString()
  @IsNotEmpty()
  mimeType: string;

  @IsNumber()
  @IsNotEmpty()
  size: number;

  @IsEnum(ResourceType)
  @IsNotEmpty()
  type: ResourceType;

  @IsString()
  @IsOptional()
  workspaceId?: string;

  @IsString()
  @IsOptional()
  refType?: string;

  @IsString()
  @IsOptional()
  refId?: string;
  @IsString()
  @IsNotEmpty()
  uploadedBy: string;
}
