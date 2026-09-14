import { IsNotEmpty, IsObject, IsOptional, IsString } from 'class-validator';

export class CreateViewApiDto {
  @IsString()
  @IsNotEmpty()
  type: string; // validate nghiêm (ViewType) ở note microservice

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>;
}

export class UpdateViewApiDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>;
}
