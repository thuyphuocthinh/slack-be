import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsEnum, IsNotEmpty, IsString, ValidateNested, IsOptional } from 'class-validator';
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
}
