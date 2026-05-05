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
  IsArray,
} from 'class-validator';

export class CreateBoardApiDto {
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

  @ApiPropertyOptional({ example: 'Updated Description' })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({ example: '2026-05-05T00:00:00Z' })
  @IsString()
  @IsOptional()
  startDate?: string;

  @ApiPropertyOptional({ example: '2026-05-06T00:00:00Z' })
  @IsString()
  @IsOptional()
  dueDate?: string;
}

export class QueryTaskApiDto {
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

export class ChangeGroupOrderApiDto {
  @ApiProperty({ example: 'source-group-uuid' })
  @IsUUID()
  @IsNotEmpty()
  sourceGroupId: string;

  @ApiProperty({ example: 'target-group-uuid' })
  @IsUUID()
  @IsNotEmpty()
  targetGroupId: string;
}

export class DragDropTaskApiDto {
  @ApiProperty({ example: 'task-uuid' })
  @IsUUID()
  @IsNotEmpty()
  taskId: string;

  @ApiProperty({ example: 'target-group-uuid' })
  @IsUUID()
  @IsNotEmpty()
  targetGroupId: string;

  @ApiProperty({ example: 1 })
  @IsNumber()
  @IsNotEmpty()
  targetOrder: number;
}

export class ChangeTaskGroupApiDto {
  @ApiProperty({ example: 'target-group-uuid' })
  @IsUUID()
  @IsNotEmpty()
  targetGroupId: string;
}

export class FilterTasksApiDto {
  @ApiPropertyOptional({ example: 'Task Title' })
  @IsString()
  @IsOptional()
  name?: string;

  @ApiPropertyOptional({ example: '2026-05-05T00:00:00Z' })
  @IsString()
  @IsOptional()
  startDate?: string;

  @ApiPropertyOptional({ example: '2026-05-06T00:00:00Z' })
  @IsString()
  @IsOptional()
  dueDate?: string;

  @ApiPropertyOptional({ example: 'group-uuid' })
  @IsUUID()
  @IsOptional()
  groupId?: string;

  @ApiPropertyOptional({ example: ['member-uuid-1', 'member-uuid-2'] })
  @IsArray()
  @IsOptional()
  memberIds?: string[];

  @ApiPropertyOptional({ example: ['label-uuid-1', 'label-uuid-2'] })
  @IsArray()
  @IsOptional()
  labelIds?: string[];
}

export class CreateAttachmentApiDto {
  @ApiProperty({ example: 'Attachment Title' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  title: string;

  @ApiProperty({ example: 'https://example.com/file.pdf' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(512)
  link: string;
}
