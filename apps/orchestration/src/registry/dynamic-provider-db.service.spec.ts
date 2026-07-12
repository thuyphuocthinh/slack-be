import { Test, TestingModule } from '@nestjs/testing';
import { DynamicProviderDbService } from './dynamic-provider-db.service';
import { DynamicToolRegistryService } from './dynamic-tool-registry.service';
import { OpenApiParserService } from '../parser/openapi-parser.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
  DynamicProviderEntity,
  EDynamicProviderAuthType,
} from '../entity/dynamic-provider.entity';
import { RpcException } from '@nestjs/microservices';

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
      const tokenExpiresAt = new Date('2026-08-01T00:00:00Z');
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
        tokenExpiresAt,
        authConfig: {
          tokenUrl: 'https://accounts.spotify.com/api/token',
          clientId: 'cid',
          clientSecret: 'csecret',
        },
      });

      expect(mockRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          refreshToken: 'initial-refresh-token',
          tokenExpiresAt,
          authConfig: {
            tokenUrl: 'https://accounts.spotify.com/api/token',
            clientId: 'cid',
            clientSecret: 'csecret',
          },
        }),
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
});
