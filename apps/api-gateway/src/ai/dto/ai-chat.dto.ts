import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsEnum, IsNotEmpty, IsOptional, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class AiMessageDto {
  @ApiProperty({ example: '123', required: false })
  @IsString()
  @IsOptional()
  id?: string;

  @ApiProperty({ enum: ['user', 'assistant'] })
  @IsEnum(['user', 'assistant'])
  role: 'user' | 'assistant';

  @ApiProperty({ example: 'Xin chào' })
  @IsString()
  @IsNotEmpty()
  content: string;
}

export class AiChatDto {
  @ApiProperty({ type: [AiMessageDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AiMessageDto)
  messages: AiMessageDto[];

  @ApiProperty({ example: 'workspace-uuid', required: false })
  @IsString()
  @IsOptional()
  workspaceId?: string;
}

export class AiUploadDocumentDto {
  @ApiProperty({ example: 'workspace-uuid' })
  @IsString()
  @IsNotEmpty()
  workspaceId: string;
}

export class AiDeleteDocumentDto {
  @ApiProperty({ example: 'document.txt' })
  @IsString()
  @IsNotEmpty()
  documentName: string;

  @ApiProperty({ example: 'workspace-uuid' })
  @IsString()
  @IsNotEmpty()
  workspaceId: string;
}
