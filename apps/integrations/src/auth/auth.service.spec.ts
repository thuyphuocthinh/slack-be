import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { RpcException } from '@nestjs/microservices';
import { Repository } from 'typeorm';
import { CachedService } from '@slack/cached';
import { AuthService } from './auth.service';
import { GoogleStrategy } from './strategies/google.strategy';
import { UserIntegrationEntity } from './entity/user-integration.entity';
import { INTEGRATION_ERROR, IntegrationProvider, IntegrationTargetType, IntegrationStatus } from '@slack/constants';

jest.mock('uuid', () => ({
  v4: jest.fn(() => 'test-uuid'),
}));

jest.mock('@slack/common', () => ({
  encryptString: jest.fn((str) => `encrypted_${str}`),
  decryptString: jest.fn((str) => str ? str.replace('encrypted_', '') : str),
}));

jest.mock('@slack/cached', () => {
  return {
    CachedService: jest.fn().mockImplementation(() => ({
      set: jest.fn(),
      get: jest.fn(),
      del: jest.fn(),
    })),
  };
});

describe('AuthService', () => {
  let service: AuthService;
  let repo: Repository<UserIntegrationEntity>;
  let cachedService: CachedService;
  let googleStrategy: GoogleStrategy;

  const mockManager = {
    findOne: jest.fn(),
    save: jest.fn(),
  };

  const mockRepo = {
    find: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
    remove: jest.fn(),
    manager: {
      transaction: jest.fn().mockImplementation((cb) => cb(mockManager)),
    },
  };

  const mockCachedService = {
    set: jest.fn(),
    get: jest.fn(),
    del: jest.fn(),
  };

  const mockGoogleStrategy = {
    getAuthUrl: jest.fn(),
    exchangeToken: jest.fn(),
    refreshToken: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: getRepositoryToken(UserIntegrationEntity),
          useValue: mockRepo,
        },
        {
          provide: CachedService,
          useValue: mockCachedService,
        },
        {
          provide: GoogleStrategy,
          useValue: mockGoogleStrategy,
        },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    repo = module.get<Repository<UserIntegrationEntity>>(getRepositoryToken(UserIntegrationEntity));
    cachedService = module.get<CachedService>(CachedService);
    googleStrategy = module.get<GoogleStrategy>(GoogleStrategy);
    
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('generateAuthUrl', () => {
    it('should set redis cache and return auth url', async () => {
      mockGoogleStrategy.getAuthUrl.mockResolvedValue('https://google.com/auth');
      
      const payload = {
        userId: 'user-1',
        workspaceId: 'workspace-1',
        provider: IntegrationProvider.GOOGLE,
        targetType: IntegrationTargetType.WORKSPACE,
      };

      const result = await service.generateAuthUrl(payload);

      expect(cachedService.set).toHaveBeenCalledWith(
        'oauth_state:test-uuid',
        expect.objectContaining({
          userId: 'user-1',
          workspaceId: 'workspace-1',
          provider: IntegrationProvider.GOOGLE,
          targetType: IntegrationTargetType.WORKSPACE,
        }),
        900,
      );
      expect(mockGoogleStrategy.getAuthUrl).toHaveBeenCalledWith('test-uuid', 'workspace-1', undefined);
      expect(result).toEqual({ authUrl: 'https://google.com/auth' });
    });
  });

  describe('handleCallback', () => {
    it('should throw INVALID_STATE if state not found in cache', async () => {
      mockCachedService.get.mockResolvedValue(null);

      await expect(
        service.handleCallback({ code: 'code', state: 'invalid-state', provider: IntegrationProvider.GOOGLE })
      ).rejects.toThrow(new RpcException(INTEGRATION_ERROR.INVALID_STATE));
    });

    it('should exchange token, save to db and cleanup state', async () => {
      mockCachedService.get.mockResolvedValue({
        userId: 'user-1',
        workspaceId: 'workspace-1',
        provider: IntegrationProvider.GOOGLE,
        targetType: IntegrationTargetType.USER,
      });

      mockGoogleStrategy.exchangeToken.mockResolvedValue({
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        providerAccountId: 'user@gmail.com',
      });

      mockRepo.findOne.mockResolvedValue(null);
      mockRepo.create.mockImplementation((dto) => ({ ...dto, id: 'conn-1' }));

      const result = await service.handleCallback({ code: 'code', state: 'test-uuid', provider: IntegrationProvider.GOOGLE });

      expect(mockGoogleStrategy.exchangeToken).toHaveBeenCalledWith('code');
      expect(mockRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'conn-1',
          accessToken: 'encrypted_access-token',
          refreshToken: 'encrypted_refresh-token',
          status: IntegrationStatus.CONNECTED,
        })
      );
      expect(mockCachedService.del).toHaveBeenCalledWith('oauth_state:test-uuid');
      expect(result.success).toBe(true);
    });
  });

  describe('saveApiKey', () => {
    it('should create new connection and encrypt api key', async () => {
      mockRepo.findOne.mockResolvedValue(null);
      mockRepo.create.mockImplementation((dto) => ({ ...dto, id: 'conn-api' }));
      mockRepo.save.mockResolvedValue({ id: 'conn-api' });

      const result = await service.saveApiKey({
        userId: 'user-1',
        provider: IntegrationProvider.GITHUB,
        apiKey: 'sk-12345',
      });

      expect(mockRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          accessToken: 'encrypted_sk-12345',
          status: IntegrationStatus.CONNECTED,
        })
      );
      expect(result.success).toBe(true);
    });

    it('should update existing connection and encrypt api key', async () => {
      const existing = {
        id: 'conn-api',
        status: IntegrationStatus.DISCONNECTED,
      };
      mockRepo.findOne.mockResolvedValue(existing);
      mockRepo.save.mockResolvedValue(existing);

      const result = await service.saveApiKey({
        userId: 'user-1',
        provider: IntegrationProvider.GITHUB,
        apiKey: 'sk-new',
      });

      expect(mockRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          accessToken: 'encrypted_sk-new',
          status: IntegrationStatus.CONNECTED,
        })
      );
    });
  });

  describe('getValidAccessToken', () => {
    it('should throw if connection not found', async () => {
      mockManager.findOne.mockResolvedValue(null);

      await expect(service.getValidAccessToken('conn-1')).rejects.toThrow(
        new RpcException(INTEGRATION_ERROR.CONNECTION_NOT_FOUND)
      );
      expect(mockManager.findOne).toHaveBeenCalledWith(UserIntegrationEntity, expect.objectContaining({
        lock: { mode: 'pessimistic_write' }
      }));
    });

    it('should throw if status is DISCONNECTED', async () => {
      mockManager.findOne.mockResolvedValue({ status: IntegrationStatus.DISCONNECTED });

      await expect(service.getValidAccessToken('conn-1')).rejects.toThrow(
        new RpcException(INTEGRATION_ERROR.OAUTH_FAILED)
      );
    });

    it('should return decrypted valid access token if not expired', async () => {
      const futureDate = new Date();
      futureDate.setHours(futureDate.getHours() + 1);

      mockManager.findOne.mockResolvedValue({
        status: IntegrationStatus.CONNECTED,
        accessToken: 'encrypted_valid-access-token',
        tokenExpiry: futureDate,
      });

      const result = await service.getValidAccessToken('conn-1');
      expect(result).toBe('valid-access-token');
    });

    it('should refresh token if expiring soon and save encrypted new tokens', async () => {
      const expiringDate = new Date();
      expiringDate.setMinutes(expiringDate.getMinutes() + 2);

      const conn = {
        provider: IntegrationProvider.GOOGLE,
        status: IntegrationStatus.CONNECTED,
        accessToken: 'encrypted_old-access-token',
        refreshToken: 'encrypted_old-refresh-token',
        tokenExpiry: expiringDate,
      };

      mockManager.findOne.mockResolvedValue(conn);

      mockGoogleStrategy.refreshToken.mockResolvedValue({
        accessToken: 'new-access-token',
      });

      const result = await service.getValidAccessToken('conn-1');
      
      expect(mockGoogleStrategy.refreshToken).toHaveBeenCalledWith('old-refresh-token');
      expect(mockManager.save).toHaveBeenCalledWith(
        expect.objectContaining({ accessToken: 'encrypted_new-access-token' })
      );
      expect(result).toBe('new-access-token');
    });
  });
});
