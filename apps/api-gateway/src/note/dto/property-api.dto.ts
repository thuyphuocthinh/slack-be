import {
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

export class CreatePropertyApiDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsNotEmpty()
  type: string; // validate nghiêm (PropertyType) ở note microservice

  @IsOptional()
  @IsObject()
  options?: Record<string, unknown>;

  @IsInt()
  @Min(0)
  order: number;
}

export class UpdatePropertyApiDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsObject()
  options?: Record<string, unknown>;

  @IsOptional()
  @IsInt()
  @Min(0)
  order?: number;
}
