import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { RpcException } from '@nestjs/microservices';
import { GoogleStrategy } from './google.strategy';
import { INTEGRATION_ERROR } from '@slack/constants';

jest.mock('googleapis', () => {
  return {
    google: {
      auth: {
        OAuth2: jest.fn().mockImplementation(() => {
          return {
            generateAuthUrl: jest.fn(),
            getToken: jest.fn(),
            setCredentials: jest.fn(),
            refreshAccessToken: jest.fn(),
          };
        }),
      },
      oauth2: jest.fn().mockReturnValue({
        userinfo: {
          get: jest.fn(),
        },
      }),
    },
  };
});

describe('GoogleStrategy', () => {
  let strategy: GoogleStrategy;
  let configService: ConfigService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GoogleStrategy,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => `mock-${key}`),
          },
        },
      ],
    }).compile();

    strategy = module.get<GoogleStrategy>(GoogleStrategy);
    configService = module.get<ConfigService>(ConfigService);
  });

  it('should be defined', () => {
    expect(strategy).toBeDefined();
  });

  describe('getAuthUrl', () => {
    it('should generate auth url with default scopes', async () => {
      const mockOAuth2Client = (strategy as any).oauth2Client;
      mockOAuth2Client.generateAuthUrl.mockReturnValue('https://mock-google.com/auth');

      const url = await strategy.getAuthUrl('mock-state-id');

      expect(mockOAuth2Client.generateAuthUrl).toHaveBeenCalledWith(
        expect.objectContaining({
          scope: ['https://www.googleapis.com/auth/userinfo.email'],
          state: 'mock-state-id',
        }),
      );
      expect(url).toBe('https://mock-google.com/auth');
    });

    it('should append email scope if not provided in requested scopes', async () => {
      const mockOAuth2Client = (strategy as any).oauth2Client;
      mockOAuth2Client.generateAuthUrl.mockReturnValue('https://mock-google.com/auth');

      await strategy.getAuthUrl('mock-state-id', undefined, ['https://www.googleapis.com/auth/calendar.events']);

      expect(mockOAuth2Client.generateAuthUrl).toHaveBeenCalledWith(
        expect.objectContaining({
          scope: [
            'https://www.googleapis.com/auth/calendar.events',
            'https://www.googleapis.com/auth/userinfo.email',
          ],
        }),
      );
    });
  });

  describe('exchangeToken', () => {
    it('should exchange code for tokens and fetch user metadata', async () => {
      const mockOAuth2Client = (strategy as any).oauth2Client;
      mockOAuth2Client.getToken.mockResolvedValue({
        tokens: {
          access_token: 'access-123',
          refresh_token: 'refresh-123',
          expiry_date: 1672531200000,
        },
      });

      const { google } = require('googleapis');
      google.oauth2().userinfo.get.mockResolvedValue({
        data: {
          email: 'test@example.com',
          picture: 'https://example.com/pic.jpg',
        },
      });

      const result = await strategy.exchangeToken('mock-code');

      expect(result.accessToken).toBe('access-123');
      expect(result.refreshToken).toBe('refresh-123');
      expect(result.providerAccountId).toBe('test@example.com');
      expect(result.metadata.email).toBe('test@example.com');
    });

    it('should throw OAUTH_FAILED if exchange fails', async () => {
      const mockOAuth2Client = (strategy as any).oauth2Client;
      mockOAuth2Client.getToken.mockRejectedValue(new Error('Invalid grant'));

      await expect(strategy.exchangeToken('mock-code')).rejects.toThrow(
        new RpcException(INTEGRATION_ERROR.OAUTH_FAILED)
      );
    });
  });

  describe('refreshToken', () => {
    it('should refresh access token', async () => {
      const mockOAuth2Client = (strategy as any).oauth2Client;
      mockOAuth2Client.refreshAccessToken.mockResolvedValue({
        credentials: {
          access_token: 'new-access-123',
        },
      });

      const result = await strategy.refreshToken('old-refresh-123');

      expect(mockOAuth2Client.setCredentials).toHaveBeenCalledWith({ refresh_token: 'old-refresh-123' });
      expect(result.accessToken).toBe('new-access-123');
      expect(result.refreshToken).toBe('old-refresh-123'); // Should fallback to old refresh token
    });
  });
});
