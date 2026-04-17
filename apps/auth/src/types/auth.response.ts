export type TokenType = 'Bearer';

export interface ITokenResponse {
  accessToken: string;
  refreshToken: string;
  type: TokenType;
}

export interface ITwoFactorResponse {
  isEnableTwoFactor: boolean;
  tempToken: string;
}
