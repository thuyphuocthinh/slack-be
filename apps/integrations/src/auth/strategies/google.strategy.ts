import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { google } from 'googleapis';
import { IOAuthStrategy } from './base.strategy';
import { RpcException } from '@nestjs/microservices';
import { INTEGRATION_ERROR } from '@slack/constants';
import { ExchangeTokenResponseDto } from '../dto/auth.dto';

@Injectable()
export class GoogleStrategy implements IOAuthStrategy {
  private oauth2Client: any;

  constructor(private readonly configService: ConfigService) {
    this.oauth2Client = new google.auth.OAuth2(
      this.configService.get<string>('GOOGLE_CLIENT_ID'),
      this.configService.get<string>('GOOGLE_CLIENT_SECRET'),
      this.configService.get<string>('GOOGLE_REDIRECT_URI'),
    );
  }

  async getAuthUrl(stateId: string, workspaceId?: string, requestedScopes?: string[]): Promise<string> {
    const defaultScopes = [
      'https://www.googleapis.com/auth/userinfo.email',
    ];

    let scopes = requestedScopes && requestedScopes.length > 0 ? requestedScopes : defaultScopes;
    
    // Ensure email is always requested to identify the user
    if (!scopes.includes('https://www.googleapis.com/auth/userinfo.email')) {
      scopes.push('https://www.googleapis.com/auth/userinfo.email');
    }

    return this.oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: scopes,
      prompt: 'consent',
      state: stateId,
    });
  }

  async exchangeToken(code: string): Promise<ExchangeTokenResponseDto> {
    try {
      const { tokens } = await this.oauth2Client.getToken(code);
      this.oauth2Client.setCredentials(tokens);

      const oauth2 = google.oauth2({ version: 'v2', auth: this.oauth2Client });
      const userInfo = await oauth2.userinfo.get();

      return {
        accessToken: tokens.access_token!,
        refreshToken: tokens.refresh_token,
        expiryDate: tokens.expiry_date ? new Date(tokens.expiry_date) : undefined,
        providerAccountId: userInfo.data.email || undefined,
        metadata: {
          email: userInfo.data.email,
          picture: userInfo.data.picture,
        },
      };
    } catch (error) {
      throw new RpcException(INTEGRATION_ERROR.OAUTH_FAILED);
    }
  }

  async refreshToken(refreshToken: string): Promise<ExchangeTokenResponseDto> {
    try {
      this.oauth2Client.setCredentials({ refresh_token: refreshToken });
      const { credentials } = await this.oauth2Client.refreshAccessToken();

      return {
        accessToken: credentials.access_token!,
        refreshToken: credentials.refresh_token || refreshToken, // Google might not send a new refresh token
        expiryDate: credentials.expiry_date ? new Date(credentials.expiry_date) : undefined,
      };
    } catch (error) {
      // If error is invalid_grant, it means the user revoked access
      throw new RpcException(INTEGRATION_ERROR.OAUTH_FAILED);
    }
  }
}
