import { Test, TestingModule } from '@nestjs/testing';
import { DynamicToolRegistryService } from './dynamic-tool-registry.service';
import { OpenApiParserService } from '../parser/openapi-parser.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DynamicProviderEntity } from '../entity/dynamic-provider.entity';
import { OpenAPI } from 'openapi-types';
import { RpcException } from '@nestjs/microservices';

describe('DynamicToolRegistryService', () => {
  let service: DynamicToolRegistryService;
  let parserService: jest.Mocked<OpenApiParserService>;
  let mockRepo: any;

  beforeEach(async () => {
    const mockParserService = {
      loadSpec: jest.fn(),
    };
    
    mockRepo = {
      findOne: jest.fn(),
      count: jest.fn(),
    };

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
        }
      ],
    }).compile();

    service = module.get<DynamicToolRegistryService>(DynamicToolRegistryService);
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
    mockRepo.findOne.mockResolvedValue({ specUrl: 'http://example.com/spec.json', isActive: true });
    mockRepo.count.mockResolvedValue(1);

    const providerId = 'dynamic_test_1';

    // 1. isDynamicProvider
    const isDynamic = await service.isDynamicProvider(providerId);
    expect(isDynamic).toBe(true);

    // 2. getTools (will trigger lazy load)
    const tools = await service.getTools(providerId);
    expect(parserService.loadSpec).toHaveBeenCalledWith('http://example.com/spec.json');
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
});
