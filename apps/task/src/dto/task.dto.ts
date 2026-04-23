import {
  IsNotEmpty,
  IsString,
  IsUUID,
  IsOptional,
  IsArray,
  IsDateString,
  IsNumber,
} from 'class-validator';

export class CreateTaskDto {
  @IsUUID()
  @IsNotEmpty()
  groupId: string;

  @IsString()
  @IsNotEmpty()
  title: string;
}

export class UpdateTaskDto {
  @IsString()
  @IsOptional()
  title?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsDateString()
  @IsOptional()
  dueDate?: string;

  @IsArray()
  @IsUUID(undefined, { each: true })
  @IsOptional()
  assigneeIds?: string[];

  @IsArray()
  @IsUUID(undefined, { each: true })
  @IsOptional()
  labelIds?: string[];

  @IsNumber()
  @IsOptional()
  order?: number;

  @IsUUID()
  @IsOptional()
  groupId?: string;
}

export class TaskResponseDto {
  id: string;
  groupId: string;
  title: string;
  description: string;
  dueDate: Date;
  order: number;
  assigneeIds: string[];
  createdAt: Date;
  updatedAt: Date;
}
