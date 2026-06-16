import { OAuthScope } from '@slack/constants';

// ================= DEVELOPER CONSOLE =================

export interface ICreateOAuthClientDto {
  name: string;
  logoUrl?: string;
  redirectUris: string[];
}

export interface IUpdateOAuthClientDto {
  name?: string;
  logoUrl?: string;
  redirectUris?: string[];
  allowedScopes?: OAuthScope[];
}

export interface IOAuthClientResponse {
  id: string;
  ownerId: string;
  name: string;
  logoUrl: string | null;
  clientId: string;
  redirectUris: string[];
  allowedScopes: OAuthScope[];
  createdAt: Date;
  updatedAt: Date;
}

export interface IOAuthClientWithSecretResponse extends IOAuthClientResponse {
  clientSecret: string; // Plain text (returned only on create/regenerate)
}

// ================= OAUTH PROVIDER FLOW =================

export interface IGetOAuthAuthorizeDetailsDto {
  clientId: string;
  redirectUri: string;
}

export interface IOAuthAuthorizeDetailsResponse {
  clientName: string;
  clientLogoUrl: string | null;
  allowedScopes: OAuthScope[];
}

export interface IOAuthApproveConsentDto {
  clientId: string;
  redirectUri: string;
  scopes: OAuthScope[];
}

export interface IOAuthApproveConsentResponse {
  redirectUrl: string;
}

export interface IOAuthTokenExchangeDto {
  clientId: string;
  clientSecret: string;
  grantType?: string;
  code?: string;
  redirectUri?: string;
  refreshToken?: string;
}

export interface IOAuthTokenExchangeResponse {
  accessToken: string;
  refreshToken: string;
  tokenType: string;
  expiresIn: number;
  idToken?: string;
}

export interface IOAuthUserInfoResponse {
  sub: string;
  name: string;
  email: string;
  picture?: string;
}

export interface IOAuthRevokeTokenDto {
  clientId: string;
  clientSecret: string;
  token: string;
  tokenTypeHint?: string;
}

export interface IOAuthAuthorizedClientResponse {
  id: string;
  clientId: string;
  name: string;
  logoUrl: string | null;
  authorizedScopes: string[];
  authorizedAt: Date;
}
