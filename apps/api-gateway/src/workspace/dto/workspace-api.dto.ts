import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { WorkspaceRoleEnum } from '@slack/constants';
import {
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
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
