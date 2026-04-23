import {
  IsNotEmpty,
  IsString,
  IsUUID,
  IsHexColor,
  IsOptional,
} from 'class-validator';

export class CreateLabelDto {
  @IsUUID()
  @IsNotEmpty()
  workspaceId: string;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsHexColor()
  @IsNotEmpty()
  color: string;
}

export class UpdateLabelDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsHexColor()
  @IsOptional()
  color?: string;
}

export class LabelResponseDto {
  id: string;
  workspaceId: string;
  name: string;
  color: string;
}
