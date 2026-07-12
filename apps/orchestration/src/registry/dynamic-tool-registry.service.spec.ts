import { Test, TestingModule } from '@nestjs/testing';
import { DynamicToolRegistryService } from './dynamic-tool-registry.service';
import { OpenApiParserService } from '../parser/openapi-parser.service';
import { OpenAiEmbeddingProvider } from './openai-embedding.provider';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DynamicProviderEntity } from '../entity/dynamic-provider.entity';
import { OpenAPI } from 'openapi-types';
import { RpcException } from '@nestjs/microservices';

/** A spec with `operationCount` GET operations — operation 0 is about "refund", the rest are
 *  generic filler — enough to exercise the >128-tool semantic-search path deterministically. */
function makeLargeSpec(operationCount: number): OpenAPI.Document {
  const paths: Record<string, unknown> = {};
  for (let i = 0; i < operationCount; i++) {
    paths[`/path${i}`] = {
      get: {
        operationId: i === 0 ? 'getRefundStatus' : `op${i}`,
        summary:
          i === 0
            ? 'Get refund status for an order'
            : `Generic operation number ${i}`,
        responses: { '200': { description: 'Success' } },
      },
    };
  }
  return {
    openapi: '3.0.0',
    info: { title: 'Big API', version: '1.0.0' },
    paths,
  } as unknown as OpenAPI.Document;
}

/** Keyword-based fake embedding: anything mentioning "refund" gets vector [1,0], everything else
 *  [0,1] — avoids hand-listing a fixture vector per tool for a 130+-tool fixture. */
function fakeEmbeddingProvider() {
  return {
    embed: jest.fn(async (texts: string[]) =>
      texts.map((t) => (t.toLowerCase().includes('refund') ? [1, 0] : [0, 1])),
    ),
  };
}

describe('DynamicToolRegistryService', () => {
  let service: DynamicToolRegistryService;
  let parserService: jest.Mocked<OpenApiParserService>;
  let embeddingProvider: ReturnType<typeof fakeEmbeddingProvider>;
  let mockRepo: any;

  beforeEach(async () => {
    const mockParserService = {
      loadSpec: jest.fn(),
    };

    mockRepo = {
      findOne: jest.fn(),
      count: jest.fn(),
    };

    embeddingProvider = fakeEmbeddingProvider();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DynamicToolRegistryService,
        {
          provide: OpenApiParserService,
          useValue: mockParserService,
        },
        {
          provide: getRepositoryToken(DynamicProviderEntity),
          useValue: mockRepo,
        },
        {
          provide: OpenAiEmbeddingProvider,
          useValue: embeddingProvider,
        },
      ],
    }).compile();

    service = module.get<DynamicToolRegistryService>(
      DynamicToolRegistryService,
    );
    parserService = module.get(OpenApiParserService);
  });

  it('should lazy load spec from DB and parse tools correctly', async () => {
    const mockDoc = {
      openapi: '3.0.0',
      info: { title: 'Test API', version: '1.0.0' },
      paths: {
        '/test': {
          get: {
            operationId: 'getTest',
            responses: { '200': { description: 'Success' } },
          },
        },
      },
    } as unknown as OpenAPI.Document;

    parserService.loadSpec.mockResolvedValue(mockDoc);
    mockRepo.findOne.mockResolvedValue({
      specUrl: 'http://example.com/spec.json',
      isActive: true,
    });
    mockRepo.count.mockResolvedValue(1);

    const providerId = 'dynamic_test_1';

    // 1. isDynamicProvider
    const isDynamic = await service.isDynamicProvider(providerId);
    expect(isDynamic).toBe(true);

    // 2. getTools (will trigger lazy load)
    const tools = await service.getTools(providerId);
    expect(parserService.loadSpec).toHaveBeenCalledWith(
      'http://example.com/spec.json',
    );
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe('getTest');

    // 3. getSpec
    const spec = await service.getSpec(providerId);
    expect(spec).toEqual(mockDoc);

    // 4. Should be in RAM now
    expect(service.getAllProviders()).toContain(providerId);
  });

  it('should throw RpcException when getting tools for unknown provider', async () => {
    mockRepo.findOne.mockResolvedValue(null);

    await expect(service.getTools('unknown')).rejects.toThrow(RpcException);
    await expect(service.getSpec('unknown')).rejects.toThrow(RpcException);
  });

  it('should remove a provider correctly', async () => {
    mockRepo.findOne.mockResolvedValue({ specUrl: 'url', isActive: true });
    parserService.loadSpec.mockResolvedValue({} as any);

    // Trigger load
    await service.getTools('p1');
    expect(service.getAllProviders()).toContain('p1');

    // Remove
    service.removeProvider('p1');
    expect(service.getAllProviders()).not.toContain('p1');

    // RAM cleared, but if db count still > 0, isDynamicProvider returns true
    mockRepo.count.mockResolvedValue(0);
    expect(await service.isDynamicProvider('p1')).toBe(false);
  });

  describe('semantic tool search (Giai đoạn 4 — Tool RAG, >128 tools)', () => {
    beforeEach(() => {
      mockRepo.findOne.mockResolvedValue({
        specUrl: 'http://example.com/big-spec.json',
        isActive: true,
      });
    });

    it('returns every tool untouched, without calling the embedding provider, when there are 128 or fewer', async () => {
      parserService.loadSpec.mockResolvedValue(makeLargeSpec(50));

      const tools = await service.getTools(
        'small_provider',
        'irrelevant query',
      );

      expect(tools).toHaveLength(50);
      expect(embeddingProvider.embed).not.toHaveBeenCalled();
    });

    it('falls back to the first 128 tools without calling the embedding provider when no query is given', async () => {
      parserService.loadSpec.mockResolvedValue(makeLargeSpec(130));

      const tools = await service.getTools('big_provider');

      expect(tools).toHaveLength(128);
      expect(tools[0].name).toBe('getRefundStatus');
      expect(embeddingProvider.embed).not.toHaveBeenCalled();
    });

    it('ranks by semantic similarity and returns the top 20 when there are more than 128 tools and a query is given', async () => {
      parserService.loadSpec.mockResolvedValue(makeLargeSpec(130));

      const tools = await service.getTools(
        'big_provider',
        'tôi cần kiểm tra refund của đơn hàng',
      );

      expect(tools.length).toBeLessThanOrEqual(20);
      expect(tools[0].name).toBe('getRefundStatus');
      // The 130-tool batch is embedded once, plus once more for the query text itself.
      expect(embeddingProvider.embed).toHaveBeenCalledTimes(2);
      expect(embeddingProvider.embed.mock.calls[0][0]).toHaveLength(130);
      expect(embeddingProvider.embed.mock.calls[1][0]).toEqual([
        'tôi cần kiểm tra refund của đơn hàng',
      ]);
    });

    it('falls back to the first 128 tools when the embedding provider fails, instead of throwing', async () => {
      parserService.loadSpec.mockResolvedValue(makeLargeSpec(130));
      embeddingProvider.embed.mockRejectedValueOnce(
        new Error('embedding API down'),
      );

      const tools = await service.getTools('big_provider', 'tôi cần refund');

      expect(tools).toHaveLength(128);
    });

    it('builds the semantic index only once — a second search() with a different query reuses it', async () => {
      parserService.loadSpec.mockResolvedValue(makeLargeSpec(130));

      await service.getTools('big_provider', 'refund query 1');
      await service.getTools('big_provider', 'refund query 2');

      // 1 batch-embed of all 130 tools (only on the first call) + 1 query-embed per call = 3 total.
      expect(embeddingProvider.embed).toHaveBeenCalledTimes(3);
      expect(embeddingProvider.embed.mock.calls[0][0]).toHaveLength(130);
      expect(embeddingProvider.embed.mock.calls[1][0]).toEqual([
        'refund query 1',
      ]);
      expect(embeddingProvider.embed.mock.calls[2][0]).toEqual([
        'refund query 2',
      ]);
    });
  });
});
