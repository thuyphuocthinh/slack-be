import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsEnum, IsOptional, IsArray } from 'class-validator';
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
}
