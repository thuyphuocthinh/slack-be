import { Test, TestingModule } from '@nestjs/testing';
import axios from 'axios';
import { DynamicProviderDbService } from './dynamic-provider-db.service';
import { DynamicToolRegistryService } from './dynamic-tool-registry.service';
import { OpenApiParserService } from '../parser/openapi-parser.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
  DynamicProviderEntity,
  EDynamicProviderAuthType,
} from '../entity/dynamic-provider.entity';
import { RpcException } from '@nestjs/microservices';

jest.mock('axios');

describe('DynamicProviderDbService', () => {
  let service: DynamicProviderDbService;
  let mockRepo: any;
  let mockRegistryService: jest.Mocked<
    Pick<DynamicToolRegistryService, 'getTools' | 'removeProvider'>
  >;
  let mockParserService: jest.Mocked<Pick<OpenApiParserService, 'loadSpec'>>;

  beforeEach(async () => {
    mockRepo = {
      create: jest.fn((data) => data),
      save: jest.fn(),
      remove: jest.fn(),
      find: jest.fn(),
      findOne: jest.fn(),
    };
    mockRegistryService = {
      getTools: jest.fn().mockResolvedValue([]),
      removeProvider: jest.fn(),
    };
    mockParserService = {
      loadSpec: jest.fn().mockResolvedValue({}),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DynamicProviderDbService,
        {
          provide: getRepositoryToken(DynamicProviderEntity),
          useValue: mockRepo,
        },
        { provide: DynamicToolRegistryService, useValue: mockRegistryService },
        { provide: OpenApiParserService, useValue: mockParserService },
      ],
    }).compile();

    service = module.get<DynamicProviderDbService>(DynamicProviderDbService);
  });

  describe('createProvider', () => {
    it('persists the OAuth2 lifecycle fields (refreshToken/tokenExpiresAt/authConfig) — regression test for the bug where they were silently dropped', async () => {
      mockRepo.save.mockImplementation((entity: any) =>
        Promise.resolve({
          ...entity,
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
      );

      await service.createProvider({
        userId: 'user-1',
        name: 'Spotify',
        specUrl: 'https://api.spotify.com/openapi.json',
        authType: EDynamicProviderAuthType.OAUTH2,
        accessToken: 'initial-access-token',
        refreshToken: 'initial-refresh-token',
        // Absolute expiry, as resolved by the controller's eager-refresh step — this service just
        // passes it through unchanged.
        tokenExpiresAt: new Date('2026-08-01T00:00:00Z'),
        authConfig: {
          tokenUrl: 'https://accounts.spotify.com/api/token',
          clientId: 'cid',
          clientSecret: 'csecret',
        },
      });

      expect(mockRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          refreshToken: 'initial-refresh-token',
          tokenExpiresAt: new Date('2026-08-01T00:00:00Z'),
          authConfig: {
            tokenUrl: 'https://accounts.spotify.com/api/token',
            clientId: 'cid',
            clientSecret: 'csecret',
          },
        }),
      );
    });

    it('leaves tokenExpiresAt undefined when not given', async () => {
      mockRepo.save.mockImplementation((entity: any) =>
        Promise.resolve(entity),
      );

      await service.createProvider({
        userId: 'user-1',
        name: 'Test API',
        specUrl: 'https://example.com/spec.json',
      });

      expect(mockRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ tokenExpiresAt: undefined }),
      );
    });

    it('generates a "dynamic_" prefixed id and parses the spec before saving', async () => {
      mockRepo.save.mockImplementation((entity: any) =>
        Promise.resolve(entity),
      );

      const result = await service.createProvider({
        userId: 'user-1',
        name: 'Test API',
        specUrl: 'https://example.com/spec.json',
      });

      expect(mockParserService.loadSpec).toHaveBeenCalledWith(
        'https://example.com/spec.json',
      );
      expect(result.id).toMatch(/^dynamic_/);
    });

    it('warms the registry RAM cache for the new provider after saving', async () => {
      mockRepo.save.mockImplementation((entity: any) =>
        Promise.resolve(entity),
      );

      const result = await service.createProvider({
        userId: 'user-1',
        name: 'Test API',
        specUrl: 'https://example.com/spec.json',
      });

      expect(mockRegistryService.getTools).toHaveBeenCalledWith(result.id);
    });

    it('throws RpcException when the DB save fails', async () => {
      mockRepo.save.mockRejectedValue(new Error('connection lost'));

      await expect(
        service.createProvider({
          userId: 'user-1',
          name: 'Test API',
          specUrl: 'https://example.com/spec.json',
        }),
      ).rejects.toThrow(RpcException);
    });

    it('does not throw when warming the RAM cache fails after a successful save — the provider is still created', async () => {
      mockRepo.save.mockImplementation((entity: any) =>
        Promise.resolve(entity),
      );
      mockRegistryService.getTools.mockRejectedValueOnce(
        new Error('spec temporarily unreachable'),
      );

      const result = await service.createProvider({
        userId: 'user-1',
        name: 'Test API',
        specUrl: 'https://example.com/spec.json',
      });

      expect(result.id).toBeDefined();
    });
  });

  describe('registerProvider', () => {
    beforeEach(() => {
      mockRepo.save.mockImplementation((entity: any) =>
        Promise.resolve(entity),
      );
    });

    it('creates the provider as-is when no refreshToken/tokenUrl is given (no eager refresh attempted)', async () => {
      const result = await service.registerProvider({
        userId: 'user-1',
        name: 'TMDB',
        specUrl: 'https://api.themoviedb.org/openapi.json',
        accessToken: 'plain-bearer-token',
        authType: EDynamicProviderAuthType.BEARER,
      });

      expect(axios.post).not.toHaveBeenCalled();
      expect(mockRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          accessToken: 'plain-bearer-token',
          refreshToken: undefined,
          tokenExpiresAt: undefined,
        }),
      );
      expect(result.id).toBeDefined();
    });

    it('eagerly refreshes once at registration when refreshToken+tokenUrl are given, and persists the real token/expiry from the provider — so the user never has to know or type "expires_in" themselves', async () => {
      (axios.post as jest.Mock).mockResolvedValue({
        data: {
          access_token: 'fresh-access-token',
          refresh_token: 'rotated-refresh-token',
          expires_in: 3600,
        },
      });

      await service.registerProvider({
        userId: 'user-1',
        name: 'Spotify',
        specUrl: 'https://api.spotify.com/openapi.json',
        accessToken: 'stale-pasted-access-token',
        authType: EDynamicProviderAuthType.OAUTH2,
        refreshToken: 'initial-refresh-token',
        tokenUrl: 'https://accounts.spotify.com/api/token',
        clientId: 'cid',
        clientSecret: 'csecret',
      });

      expect(axios.post).toHaveBeenCalledWith(
        'https://accounts.spotify.com/api/token',
        expect.objectContaining({
          grant_type: 'refresh_token',
          refresh_token: 'initial-refresh-token',
        }),
        expect.anything(),
      );
      expect(mockRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          accessToken: 'fresh-access-token',
          refreshToken: 'rotated-refresh-token',
          authConfig: {
            tokenUrl: 'https://accounts.spotify.com/api/token',
            clientId: 'cid',
            clientSecret: 'csecret',
            refreshRequestFormat: 'form',
          },
        }),
      );
      const createdArgs = mockRepo.create.mock.calls[0][0];
      expect(createdArgs.tokenExpiresAt).toBeInstanceOf(Date);
    });

    it("auto-detects a JSON body for Atlassian's token endpoint (Jira/Confluence) without the user having to configure anything", async () => {
      (axios.post as jest.Mock).mockResolvedValue({
        data: {
          access_token: 'fresh-access-token',
          refresh_token: 'rotated-refresh-token',
          expires_in: 3600,
        },
      });

      await service.registerProvider({
        userId: 'user-1',
        name: 'Jira',
        specUrl: 'https://your-domain.atlassian.net/openapi.json',
        authType: EDynamicProviderAuthType.OAUTH2,
        refreshToken: 'initial-refresh-token',
        tokenUrl: 'https://auth.atlassian.com/oauth/token',
        clientId: 'cid',
        clientSecret: 'csecret',
      });

      expect(axios.post).toHaveBeenCalledWith(
        'https://auth.atlassian.com/oauth/token',
        expect.anything(),
        { headers: { 'Content-Type': 'application/json' } },
      );
      expect(mockRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          authConfig: expect.objectContaining({ refreshRequestFormat: 'json' }),
        }),
      );
    });

    it('lets an explicit refreshRequestFormat override the auto-detected one', async () => {
      (axios.post as jest.Mock).mockResolvedValue({
        data: { access_token: 'fresh-access-token', expires_in: 3600 },
      });

      await service.registerProvider({
        userId: 'user-1',
        name: 'Spotify',
        specUrl: 'https://api.spotify.com/openapi.json',
        authType: EDynamicProviderAuthType.OAUTH2,
        refreshToken: 'initial-refresh-token',
        tokenUrl: 'https://accounts.spotify.com/api/token',
        clientId: 'cid',
        clientSecret: 'csecret',
        refreshRequestFormat: 'json',
      });

      expect(axios.post).toHaveBeenCalledWith(
        'https://accounts.spotify.com/api/token',
        expect.anything(),
        { headers: { 'Content-Type': 'application/json' } },
      );
    });

    it('threads the custom responseAccessTokenPath/responseRefreshTokenPath/responseExpiresInPath/defaultExpiresInSecs through to the refresher and persists them into authConfig — for internal auth endpoints with a fully custom response shape', async () => {
      (axios.post as jest.Mock).mockResolvedValue({
        data: {
          payload: {
            token: { at: 'fresh-access-token', rt: 'rotated-refresh-token' },
          },
        },
      });

      await service.registerProvider({
        userId: 'user-1',
        name: 'Internal HR System',
        specUrl: 'https://hr.internal.company.com/openapi.json',
        authType: EDynamicProviderAuthType.OAUTH2,
        refreshToken: 'initial-refresh-token',
        tokenUrl: 'https://hr.internal.company.com/auth/refresh',
        responseAccessTokenPath: 'payload.token.at',
        responseRefreshTokenPath: 'payload.token.rt',
        responseExpiresInPath: 'payload.token.ttl',
        defaultExpiresInSecs: 900,
      });

      expect(mockRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          accessToken: 'fresh-access-token',
          refreshToken: 'rotated-refresh-token',
          authConfig: expect.objectContaining({
            responseAccessTokenPath: 'payload.token.at',
            responseRefreshTokenPath: 'payload.token.rt',
            responseExpiresInPath: 'payload.token.ttl',
            defaultExpiresInSecs: 900,
          }),
        }),
      );
      const createdArgs = mockRepo.create.mock.calls[0][0];
      // Không có "ttl" thật trong response -> phải rơi về defaultExpiresInSecs (900s), không phải 3600s mặc định của lib.
      expect(createdArgs.tokenExpiresAt.getTime()).toBeCloseTo(
        Date.now() + 900 * 1000,
        -2,
      );
    });

    it('throws OAUTH2_REFRESH_FAILED and never creates the provider when the eager refresh fails (bad tokenUrl/clientId/clientSecret) — fails fast at connect time instead of silently 401ing later', async () => {
      (axios.post as jest.Mock).mockRejectedValue(new Error('invalid_client'));

      await expect(
        service.registerProvider({
          userId: 'user-1',
          name: 'Spotify',
          specUrl: 'https://api.spotify.com/openapi.json',
          accessToken: 'stale-pasted-access-token',
          authType: EDynamicProviderAuthType.OAUTH2,
          refreshToken: 'initial-refresh-token',
          tokenUrl: 'https://accounts.spotify.com/api/token',
          clientId: 'wrong-cid',
          clientSecret: 'wrong-csecret',
        }),
      ).rejects.toThrow(RpcException);

      expect(mockRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('updateProvider', () => {
    const existingEntity = () => ({
      id: 'dynamic_abc',
      userId: 'user-1',
      name: 'Spotify',
      specUrl: 'https://api.spotify.com/openapi.json',
      description: 'My music API',
      authType: EDynamicProviderAuthType.OAUTH2,
      accessToken: 'old-access-token',
      refreshToken: 'old-refresh-token',
      tokenExpiresAt: new Date('2026-01-01T00:00:00Z'),
      authConfig: {
        tokenUrl: 'https://accounts.spotify.com/api/token',
        clientId: 'old-cid',
        clientSecret: 'old-csecret',
        refreshRequestFormat: 'form',
      },
      isActive: true,
    });

    beforeEach(() => {
      mockRepo.save.mockImplementation((entity: any) =>
        Promise.resolve(entity),
      );
    });

    it('throws DYNAMIC_PROVIDER_NOT_FOUND when the provider does not exist or belongs to another user', async () => {
      mockRepo.findOne.mockResolvedValue(null);

      await expect(
        service.updateProvider({
          userId: 'user-1',
          providerId: 'dynamic_missing',
        }),
      ).rejects.toThrow(RpcException);
    });

    it('keeps existing values for every field not provided — "leave blank to keep unchanged"', async () => {
      mockRepo.findOne.mockResolvedValue(existingEntity());
      (axios.post as jest.Mock).mockResolvedValue({
        data: { access_token: 'fresh-access-token', expires_in: 3600 },
      });

      await service.updateProvider({
        userId: 'user-1',
        providerId: 'dynamic_abc',
      });

      expect(mockRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Spotify',
          specUrl: 'https://api.spotify.com/openapi.json',
          description: 'My music API',
          authConfig: expect.objectContaining({
            tokenUrl: 'https://accounts.spotify.com/api/token',
            clientId: 'old-cid',
            clientSecret: 'old-csecret',
          }),
        }),
      );
    });

    it('re-refreshes and gets a fresh access token using the existing refreshToken+tokenUrl — reconnect always revalidates the connection', async () => {
      mockRepo.findOne.mockResolvedValue(existingEntity());
      (axios.post as jest.Mock).mockResolvedValue({
        data: {
          access_token: 'brand-new-access-token',
          refresh_token: 'rotated-refresh-token',
          expires_in: 3600,
        },
      });

      await service.updateProvider({
        userId: 'user-1',
        providerId: 'dynamic_abc',
      });

      expect(axios.post).toHaveBeenCalledWith(
        'https://accounts.spotify.com/api/token',
        expect.objectContaining({ refresh_token: 'old-refresh-token' }),
        expect.anything(),
      );
      expect(mockRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          accessToken: 'brand-new-access-token',
          refreshToken: 'rotated-refresh-token',
        }),
      );
    });

    it('lets a newly-provided refreshToken/clientSecret override the stored ones for the refresh call', async () => {
      mockRepo.findOne.mockResolvedValue(existingEntity());
      (axios.post as jest.Mock).mockResolvedValue({
        data: { access_token: 'fresh-access-token', expires_in: 3600 },
      });

      await service.updateProvider({
        userId: 'user-1',
        providerId: 'dynamic_abc',
        refreshToken: 'new-refresh-token',
        clientSecret: 'new-csecret',
      });

      expect(axios.post).toHaveBeenCalledWith(
        'https://accounts.spotify.com/api/token',
        expect.objectContaining({
          refresh_token: 'new-refresh-token',
          client_secret: 'new-csecret',
          client_id: 'old-cid',
        }),
        expect.anything(),
      );
    });

    it('throws OAUTH2_REFRESH_FAILED and does not save when the refresh fails', async () => {
      mockRepo.findOne.mockResolvedValue(existingEntity());
      (axios.post as jest.Mock).mockRejectedValue(new Error('invalid_grant'));

      await expect(
        service.updateProvider({ userId: 'user-1', providerId: 'dynamic_abc' }),
      ).rejects.toThrow(RpcException);
      expect(mockRepo.save).not.toHaveBeenCalled();
    });

    it('invalidates the RAM cache after a successful update so the next tool call re-reads fresh credentials', async () => {
      mockRepo.findOne.mockResolvedValue(existingEntity());
      (axios.post as jest.Mock).mockResolvedValue({
        data: { access_token: 'fresh-access-token', expires_in: 3600 },
      });

      const result = await service.updateProvider({
        userId: 'user-1',
        providerId: 'dynamic_abc',
      });

      expect(mockRegistryService.removeProvider).toHaveBeenCalledWith(
        'dynamic_abc',
      );
      expect(mockRegistryService.getTools).toHaveBeenCalledWith('dynamic_abc');
      expect(result.id).toBe('dynamic_abc');
    });

    it('re-validates the spec via parserService.loadSpec when specUrl changes', async () => {
      mockRepo.findOne.mockResolvedValue(existingEntity());
      (axios.post as jest.Mock).mockResolvedValue({
        data: { access_token: 'fresh-access-token', expires_in: 3600 },
      });

      await service.updateProvider({
        userId: 'user-1',
        providerId: 'dynamic_abc',
        specUrl: 'https://api.spotify.com/v2/openapi.json',
      });

      expect(mockParserService.loadSpec).toHaveBeenCalledWith(
        'https://api.spotify.com/v2/openapi.json',
      );
    });

    it('does not attempt a refresh when the provider has no refreshToken/tokenUrl at all (plain Bearer)', async () => {
      // File-level jest.mock('axios') never resets between tests — clear call history so this
      // assertion checks calls from THIS test only, not accumulated calls from earlier tests.
      (axios.post as jest.Mock).mockClear();
      mockRepo.findOne.mockResolvedValue({
        id: 'dynamic_tmdb',
        userId: 'user-1',
        name: 'TMDB',
        specUrl: 'https://api.themoviedb.org/openapi.json',
        authType: EDynamicProviderAuthType.BEARER,
        accessToken: 'old-bearer-token',
        isActive: true,
      });

      await service.updateProvider({
        userId: 'user-1',
        providerId: 'dynamic_tmdb',
        accessToken: 'new-bearer-token',
      });

      expect(axios.post).not.toHaveBeenCalled();
      expect(mockRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ accessToken: 'new-bearer-token' }),
      );
    });
  });
});
