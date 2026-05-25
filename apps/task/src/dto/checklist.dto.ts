import {
  IsNotEmpty,
  IsString,
  IsUUID,
  IsOptional,
  IsBoolean,
} from 'class-validator';

export class CreateChecklistDto {
  @IsUUID()
  @IsNotEmpty()
  taskId: string;

  @IsString()
  @IsNotEmpty()
  name: string;
}

export class UpdateChecklistDto {
  @IsString()
  @IsOptional()
  name?: string;
}

export class AddChecklistItemDto {
  @IsUUID()
  @IsNotEmpty()
  checklistId: string;

  @IsString()
  @IsNotEmpty()
  content: string;
}

export class UpdateChecklistItemDto {
  @IsString()
  @IsOptional()
  content?: string;

  @IsBoolean()
  @IsOptional()
  isCompleted?: boolean;
}
