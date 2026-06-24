import { IsString, IsNotEmpty, IsEnum, IsUUID, IsOptional, IsArray } from 'class-validator';
import { IntegrationProvider, IntegrationTargetType, IntegrationStatus } from '@slack/constants';

export class GetMyConnectionsRequestDto {
  @IsUUID()
  @IsNotEmpty()
  userId: string;
}

export class GenerateAuthUrlRequestDto {
  @IsUUID()
  @IsNotEmpty()
  userId: string;

  @IsUUID()
  @IsNotEmpty()
  workspaceId: string;

  @IsEnum(IntegrationProvider)
  @IsNotEmpty()
  provider: IntegrationProvider;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  scopes?: string[];

  @IsOptional()
  @IsEnum(IntegrationTargetType)
  targetType?: IntegrationTargetType;

  @IsOptional()
  @IsString()
  returnUrl?: string;
}

export class HandleCallbackRequestDto {
  @IsString()
  @IsNotEmpty()
  code: string;

  @IsString()
  @IsNotEmpty()
  state: string;

  @IsEnum(IntegrationProvider)
  @IsNotEmpty()
  provider: IntegrationProvider;
}

export class RevokeConnectionRequestDto {
  @IsUUID()
  @IsNotEmpty()
  userId: string;

  @IsEnum(IntegrationProvider)
  @IsOptional()
  provider?: IntegrationProvider;

  @IsUUID()
  @IsOptional()
  connectionId?: string;
}

export class ConnectionResponseDto {
  id: string;
  provider: string;
  providerAccountId?: string;
  targetType: string;
  workspaceId?: string;
  scopes?: string[];
  status: string;
  metadata?: Record<string, any>;
  createdAt: Date;
}

export class GetMyConnectionsResponseDto {
  connections: ConnectionResponseDto[];
}

export class GenerateAuthUrlResponseDto {
  authUrl: string;
}

export class HandleCallbackResponseDto {
  success: boolean;
  provider: string;
  returnUrl?: string;
}

export class RevokeConnectionResponseDto {
  success: boolean;
}

export class SaveApiKeyRequestDto {
  @IsUUID()
  userId: string;

  @IsString()
  @IsOptional()
  workspaceId?: string;

  @IsEnum(IntegrationProvider)
  provider: IntegrationProvider;

  @IsString()
  @IsNotEmpty()
  apiKey: string;
}

export class SaveApiKeyResponseDto {
  success: boolean;
  connectionId: string;
}

export class ExchangeTokenResponseDto {
  accessToken: string;
  refreshToken?: string;
  expiryDate?: Date;
  metadata?: any;
  providerAccountId?: string;
}

