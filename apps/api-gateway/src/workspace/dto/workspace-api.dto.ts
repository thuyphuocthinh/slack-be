import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { WorkspaceRoleEnum } from '@slack/constants';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';

export class CreateWorkspaceApiDto {
  @ApiProperty({ example: 'My Workspace' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100, { message: 'Workspace name must be at most 100 characters' })
  name: string;

  @ApiPropertyOptional({ example: 'A brief description of the workspace' })
  @IsString()
  @IsOptional()
  @MaxLength(255, {
    message: 'Workspace description must be at most 255 characters',
  })
  description?: string;
}

export class UpdateWorkspaceApiDto {
  @ApiPropertyOptional({ example: 'My Workspace' })
  @IsString()
  @IsOptional()
  @MaxLength(100, { message: 'Workspace name must be at most 100 characters' })
  name?: string;

  @ApiPropertyOptional({ example: 'A brief description of the workspace' })
  @IsString()
  @IsOptional()
  @MaxLength(255, {
    message: 'Workspace description must be at most 500 characters',
  })
  description?: string;

  @ApiPropertyOptional({ example: 'https://example.com/logo.png' })
  @IsString()
  @IsOptional()
  @MaxLength(512, {
    message: 'Workspace logo must be at most 512 characters',
  })
  logo?: string;
}

export class InviteMemberApiDto {
  @ApiProperty({ example: 'user@example.com' })
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @ApiProperty({ enum: WorkspaceRoleEnum, example: WorkspaceRoleEnum.MEMBER })
  @IsEnum(WorkspaceRoleEnum)
  role: WorkspaceRoleEnum;
}

export class AddMemberDirectApiDto {
  @ApiProperty({ example: 'user-uuid' })
  @IsUUID()
  @IsNotEmpty()
  userId: string;

  @ApiProperty({ enum: WorkspaceRoleEnum, example: WorkspaceRoleEnum.MEMBER })
  @IsEnum(WorkspaceRoleEnum)
  role: WorkspaceRoleEnum;
}

export class AddBatchMembersApiDto {
  @ApiProperty({ example: ['user-uuid-1', 'user-uuid-2'] })
  @IsArray()
  userIds: string[];

  @ApiProperty({ enum: WorkspaceRoleEnum, example: WorkspaceRoleEnum.MEMBER })
  @IsEnum(WorkspaceRoleEnum)
  role: WorkspaceRoleEnum;
}

export class ChangeRoleApiDto {
  @ApiProperty({ enum: WorkspaceRoleEnum, example: WorkspaceRoleEnum.ADMIN })
  @IsEnum(WorkspaceRoleEnum)
  newRole: WorkspaceRoleEnum;
}

export class TransferOwnershipApiDto {
  @ApiProperty({ example: 'new-owner-uuid' })
  @IsUUID()
  @IsNotEmpty()
  targetUserId: string;
}

export class CreateLinkApiDto {
  @ApiPropertyOptional({ example: 100 })
  @IsNumber()
  @IsOptional()
  maxUsage?: number;
}

export class GetWorkspacesApiDto {
  @ApiPropertyOptional({ example: 1 })
  @IsNumber()
  @IsOptional()
  @Type(() => Number)
  page?: number;

  @ApiPropertyOptional({ example: 10 })
  @IsNumber()
  @IsOptional()
  @Type(() => Number)
  limit?: number;
}

export class SlashCommandApiDto {
  @ApiProperty({ example: '/weather' })
  @IsString()
  @IsNotEmpty()
  command: string;

  @ApiProperty({ example: 'Get the current weather' })
  @IsString()
  @IsNotEmpty()
  description: string;
}

export class CreateAppApiDto {
  @ApiProperty({ example: 'My Custom App' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  @ApiPropertyOptional({ example: 'A brief description of the app' })
  @IsString()
  @IsOptional()
  @MaxLength(255)
  description?: string;

  @ApiPropertyOptional({ example: 'https://example.com/avatar.png' })
  @IsString()
  @IsOptional()
  @MaxLength(512)
  avatarUrl?: string;

  @ApiPropertyOptional({ example: 'https://my-app.com/slack/events' })
  @IsString()
  @IsOptional()
  @MaxLength(512)
  requestUrl?: string;

  @ApiPropertyOptional({ example: ['app_mention', 'message.channels'] })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  eventTypes?: string[];

  @ApiPropertyOptional({ type: [SlashCommandApiDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SlashCommandApiDto)
  @IsOptional()
  slashCommands?: SlashCommandApiDto[];
}

export class UpdateAppApiDto {
  @ApiPropertyOptional({ example: 'Updated App Name' })
  @IsString()
  @IsOptional()
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional({ example: 'Updated description' })
  @IsString()
  @IsOptional()
  @MaxLength(255)
  description?: string;

  @ApiPropertyOptional({ example: 'https://example.com/avatar.png' })
  @IsString()
  @IsOptional()
  @MaxLength(512)
  avatarUrl?: string;

  @ApiPropertyOptional({ example: 'https://my-app.com/slack/events' })
  @IsString()
  @IsOptional()
  @MaxLength(512)
  requestUrl?: string;

  @ApiPropertyOptional({ example: ['app_mention'] })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  eventTypes?: string[];

  @ApiPropertyOptional({ example: 'ACTIVE' })
  @IsString()
  @IsOptional()
  status?: string;

  @ApiPropertyOptional({ type: [SlashCommandApiDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SlashCommandApiDto)
  @IsOptional()
  slashCommands?: SlashCommandApiDto[];
}

export class InvokeCommandApiDto {
  @ApiProperty({ example: 'channel_id' })
  @IsString()
  @IsNotEmpty()
  channelId: string;

  @ApiProperty({ example: '/weather' })
  @IsString()
  @IsNotEmpty()
  command: string;

  @ApiPropertyOptional({ example: 'hanoi' })
  @IsString()
  @IsOptional()
  text?: string;
}
