import { IsString, IsNotEmpty, IsOptional, IsUrl, IsArray, IsEnum } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { OAuthScope } from '@slack/constants';

export class CreateOAuthClientDto {
  @ApiProperty({ description: 'The name of the OAuth Client/Application' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ description: 'Logo URL of the client', required: false })
  @IsString()
  @IsOptional()
  logoUrl?: string;

  @ApiProperty({ description: 'Allowed redirect URIs', type: [String] })
  @IsArray()
  @IsUrl({}, { each: true })
  redirectUris: string[];
}

export class UpdateOAuthClientDto {
  @ApiProperty({ description: 'The name of the OAuth Client/Application', required: false })
  @IsString()
  @IsOptional()
  name?: string;

  @ApiProperty({ description: 'Logo URL of the client', required: false })
  @IsString()
  @IsOptional()
  logoUrl?: string;

  @ApiProperty({ description: 'Allowed redirect URIs', type: [String], required: false })
  @IsArray()
  @IsOptional()
  @IsUrl({}, { each: true })
  redirectUris?: string[];

  @ApiProperty({ description: 'Allowed scopes', enum: OAuthScope, isArray: true, required: false })
  @IsArray()
  @IsOptional()
  @IsEnum(OAuthScope, { each: true })
  allowedScopes?: OAuthScope[];
}

export class GetOAuthAuthorizeDetailsDto {
  @ApiProperty({ description: 'OAuth client_id' })
  @IsString()
  @IsNotEmpty()
  clientId: string;

  @ApiProperty({ description: 'OAuth redirect_uri' })
  @IsUrl()
  @IsNotEmpty()
  redirectUri: string;
}

export class OAuthApproveConsentDto {
  @ApiProperty({ description: 'OAuth client_id' })
  @IsString()
  @IsNotEmpty()
  clientId: string;

  @ApiProperty({ description: 'OAuth redirect_uri' })
  @IsUrl()
  @IsNotEmpty()
  redirectUri: string;

  @ApiProperty({ description: 'List of scopes approved by the user', enum: OAuthScope, isArray: true })
  @IsArray()
  @IsEnum(OAuthScope, { each: true })
  scopes: OAuthScope[];
}

export class OAuthTokenExchangeDto {
  @ApiProperty({ description: 'OAuth client_id' })
  @IsString()
  @IsNotEmpty()
  clientId: string;

  @ApiProperty({ description: 'OAuth client_secret' })
  @IsString()
  @IsNotEmpty()
  clientSecret: string;

  @ApiProperty({ description: 'OAuth grant_type: authorization_code or refresh_token', required: false })
  @IsString()
  @IsOptional()
  grantType?: string;

  @ApiProperty({ description: 'OAuth authorization code', required: false })
  @IsString()
  @IsOptional()
  code?: string;

  @ApiProperty({ description: 'OAuth redirect_uri', required: false })
  @IsUrl()
  @IsOptional()
  redirectUri?: string;

  @ApiProperty({ description: 'OAuth refresh_token', required: false })
  @IsString()
  @IsOptional()
  refreshToken?: string;
}

export class OAuthRevokeTokenDto {
  @ApiProperty({ description: 'OAuth client_id' })
  @IsString()
  @IsNotEmpty()
  clientId: string;

  @ApiProperty({ description: 'OAuth client_secret' })
  @IsString()
  @IsNotEmpty()
  clientSecret: string;

  @ApiProperty({ description: 'The access token or refresh token to revoke' })
  @IsString()
  @IsNotEmpty()
  token: string;

  @ApiProperty({ description: 'An optional hint about the type of token submitted for revocation', required: false })
  @IsString()
  @IsOptional()
  tokenTypeHint?: string;
}
