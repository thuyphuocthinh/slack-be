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
});
