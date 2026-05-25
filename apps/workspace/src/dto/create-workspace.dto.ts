import { IsString, MinLength, MaxLength } from 'class-validator';

export class CreateWorkspaceDto {
  @IsString()
  @MinLength(8)
  @MaxLength(100)
  name: string;

  @IsString()
  @MinLength(10)
  @MaxLength(255)
  description?: string;
}

export class UpdateWorkspaceDto {
  @IsString()
  @MinLength(8)
  @MaxLength(100)
  name?: string;

  @IsString()
  @MinLength(10)
  @MaxLength(255)
  description?: string;
}
