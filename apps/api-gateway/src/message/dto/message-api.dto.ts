import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateMessageApiDto {
  @IsNotEmpty()
  @ApiProperty()
  content: string | Record<string, unknown>[];

  @IsArray()
  @IsUUID('all', { each: true })
  @IsOptional()
  @ApiPropertyOptional()
  mentions?: string[];

  @IsUUID()
  @IsOptional()
  @ApiPropertyOptional()
  parentId?: string;
}

export class UpdateMessageApiDto {
  @IsNotEmpty()
  @ApiProperty()
  content: string | Record<string, unknown>[];
}

export class GetMessagesQueryApiDto {
  @IsUUID()
  @IsOptional()
  @ApiPropertyOptional()
  parentId?: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  @ApiPropertyOptional({ default: 20 })
  limit?: number = 20;

  @IsString()
  @IsOptional()
  @ApiPropertyOptional()
  cursor?: string;
}

export class ToggleReactionApiDto {
  @IsString()
  @IsNotEmpty()
  @ApiProperty()
  emoji: string;
}

export class SearchMessagesQueryApiDto {
  @IsString()
  @IsNotEmpty()
  @ApiProperty()
  keyword: string;
}

export class GetThreadQueryApiDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  @ApiPropertyOptional({ default: 10 })
  limit?: number = 10;

  @IsString()
  @IsOptional()
  @ApiPropertyOptional()
  cursor?: string;
}
