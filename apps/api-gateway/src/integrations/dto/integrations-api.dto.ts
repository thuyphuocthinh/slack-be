import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsEnum, IsOptional, IsArray } from 'class-validator';
import { Transform } from 'class-transformer';
import { IntegrationProvider, IntegrationTargetType } from '@slack/constants';

export class GenerateAuthUrlQueryDto {
  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  workspaceId?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  returnUrl?: string;

  @ApiPropertyOptional({ enum: IntegrationTargetType })
  @IsEnum(IntegrationTargetType)
  @IsOptional()
  targetType?: IntegrationTargetType;

  @ApiPropertyOptional({ type: [String] })
  @Transform(({ value }) => Array.isArray(value) ? value : [value])
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  scopes?: string[];
}

export class AuthCallbackQueryDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  code: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  state: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  scope?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  authuser?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  prompt?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  iss?: string;
}
