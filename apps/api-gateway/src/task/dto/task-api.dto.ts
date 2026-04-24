import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsNotEmpty,
  IsString,
  IsUUID,
  IsOptional,
  IsNumber,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateBoardApiDto {
  @ApiProperty({ example: 'workspace-uuid' })
  @IsUUID()
  @IsNotEmpty()
  workspaceId: string;

  @ApiProperty({ example: 'https://example.com/bg.png' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(512)
  backgroundUrl: string;

  @ApiProperty({ example: 'Development' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;
}

export class UpdateBoardApiDto {
  @ApiPropertyOptional({ example: 'Updated Name' })
  @IsString()
  @IsOptional()
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional({ example: 'https://example.com/new-bg.png' })
  @IsString()
  @IsOptional()
  @MaxLength(512)
  backgroundUrl?: string;
}

export class QueryBoardApiDto {
  @ApiProperty({ example: 'workspace-uuid' })
  @IsUUID()
  @IsNotEmpty()
  workspaceId: string;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ example: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  limit?: number = 20;
}

export class CreateGroupApiDto {
  @ApiProperty({ example: 'board-uuid' })
  @IsUUID()
  @IsNotEmpty()
  boardId: string;

  @ApiProperty({ example: 'To Do' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  @ApiPropertyOptional({ example: 1 })
  @IsNumber()
  @IsOptional()
  order?: number;
}

export class UpdateGroupApiDto {
  @ApiPropertyOptional({ example: 'In Progress' })
  @IsString()
  @IsOptional()
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional({ example: 2 })
  @IsNumber()
  @IsOptional()
  order?: number;
}

export class CreateTaskApiDto {
  @ApiProperty({ example: 'group-uuid' })
  @IsUUID()
  @IsNotEmpty()
  groupId: string;

  @ApiProperty({ example: 'Task Title' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  title: string;
}

export class UpdateTaskApiDto {
  @ApiPropertyOptional({ example: 'Updated Title' })
  @IsString()
  @IsOptional()
  @MaxLength(255)
  title?: string;
}

export class QueryTaskApiDto {
  @ApiProperty({ example: 'group-uuid' })
  @IsUUID()
  @IsNotEmpty()
  groupId: string;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ example: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  limit?: number = 20;
}

export class CreateLabelApiDto {
  @ApiProperty({ example: 'board-uuid' })
  @IsUUID()
  @IsNotEmpty()
  boardId: string;

  @ApiProperty({ example: 'Bug' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  name: string;

  @ApiProperty({ example: '#ff0000' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  color: string;
}

export class UpdateLabelApiDto {
  @ApiPropertyOptional({ example: 'Enhancement' })
  @IsString()
  @IsOptional()
  @MaxLength(50)
  name?: string;

  @ApiPropertyOptional({ example: '#00ff00' })
  @IsString()
  @IsOptional()
  @MaxLength(20)
  color?: string;
}

export class AddMemberToBoardApiDto {
  @ApiProperty({ example: 'member-uuid' })
  @IsUUID()
  @IsNotEmpty()
  memberId: string;
}

export class ToggleTaskLabelApiDto {
  @ApiProperty({ example: 'label-uuid' })
  @IsUUID()
  @IsNotEmpty()
  labelId: string;
}

export class CreateChecklistApiDto {
  @ApiProperty({ example: 'task-uuid' })
  @IsUUID()
  @IsNotEmpty()
  taskId: string;

  @ApiProperty({ example: 'Acceptance Criteria' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;
}

export class UpdateChecklistApiDto {
  @ApiPropertyOptional({ example: 'Updated Checklist Name' })
  @IsString()
  @IsOptional()
  @MaxLength(100)
  name?: string;
}

export class AddChecklistItemApiDto {
  @ApiProperty({ example: 'checklist-uuid' })
  @IsUUID()
  @IsNotEmpty()
  checklistId: string;

  @ApiProperty({ example: 'Complete unit tests' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(512)
  content: string;
}

export class UpdateChecklistItemApiDto {
  @ApiPropertyOptional({ example: 'Update unit tests' })
  @IsString()
  @IsOptional()
  @MaxLength(512)
  content?: string;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  isCompleted?: boolean;
}
