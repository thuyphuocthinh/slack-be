import {
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';

export class CreateBlockApiDto {
  @IsUUID()
  @IsNotEmpty()
  pageId: string;

  @IsString()
  @IsNotEmpty()
  type: string; // validate nghiêm (BlockType) ở note microservice

  @IsObject()
  @IsNotEmpty()
  content: Record<string, unknown>;

  @IsInt()
  @Min(0)
  order: number;

  @IsOptional()
  @IsUUID()
  parentId?: string;
}

export class UpdateBlockApiDto {
  @IsOptional()
  @IsObject()
  content?: Record<string, unknown>;

  @IsOptional()
  @IsInt()
  @Min(0)
  order?: number;

  @IsOptional()
  @IsUUID()
  parentId?: string;
}
