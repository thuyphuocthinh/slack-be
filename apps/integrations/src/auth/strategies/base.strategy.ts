import { ExchangeTokenResponseDto } from '../dto/auth.dto';

export interface IOAuthStrategy {
  getAuthUrl(stateId: string, workspaceId?: string, requestedScopes?: string[]): Promise<string>;
  exchangeToken(code: string): Promise<ExchangeTokenResponseDto>;
  refreshToken?(refreshToken: string): Promise<ExchangeTokenResponseDto>;
}
