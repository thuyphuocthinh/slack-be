import { Test, TestingModule } from '@nestjs/testing';
import { DynamicToolExecutorService } from './dynamic-tool-executor.service';
import { DynamicToolRegistryService } from '../registry/dynamic-tool-registry.service';
import axios from 'axios';
import { OpenAPIV3 } from 'openapi-types';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DynamicProviderEntity } from '../entity/dynamic-provider.entity';
import { QueueService } from '@slack/queue';

jest.mock('axios');
jest.mock('nanoid', () => ({
  customAlphabet: jest.fn().mockReturnValue(() => 'mocked-id'),
}), { virtual: true });

describe('DynamicToolExecutorService', () => {
  let service: DynamicToolExecutorService;
  let registryService: jest.Mocked<DynamicToolRegistryService>;

  beforeEach(async () => {
    const mockRegistryService = {
      getProviderSpec: jest.fn(),
    };

    const mockRepo = {
      update: jest.fn().mockResolvedValue({}),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DynamicToolExecutorService,
        {
          provide: DynamicToolRegistryService,
          useValue: mockRegistryService,
        },
        {
          provide: getRepositoryToken(DynamicProviderEntity),
          useValue: mockRepo,
        },
        {
          provide: QueueService,
          useValue: { addJob: jest.fn().mockResolvedValue({}) },
        },
      ],
    }).compile();

    service = module.get<DynamicToolExecutorService>(DynamicToolExecutorService);
    registryService = module.get(DynamicToolRegistryService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should format URL correctly with path and query parameters', async () => {
    const mockSpec: OpenAPIV3.Document = {
      openapi: '3.0.0',
      info: { title: 'Test', version: '1.0' },
      servers: [{ url: 'https://api.test.com' }],
      paths: {
        '/users/{userId}': {
          get: {
            operationId: 'getUser',
            parameters: [
              { name: 'userId', in: 'path', required: true },
              { name: 'includeDetails', in: 'query', required: false },
            ],
          } as any,
        },
      },
    };

    registryService.getProviderSpec.mockResolvedValue({ 
      providerId: 'test_provider',
      specUrl: 'http://test',
      document: mockSpec, 
      tools: [] 
    });
    (axios as unknown as jest.Mock).mockResolvedValue({ data: { id: 123, name: 'John' } });

    const result = await service.execute('test_provider', 'getUser', {
      userId: 123,
      includeDetails: true,
    });

    expect(result.isError).toBe(false);
    expect(result.content).toHaveLength(1);
    expect(result.content![0].text).toContain('John');

    expect(axios).toHaveBeenCalledWith(expect.objectContaining({
      method: 'get',
      url: 'https://api.test.com/users/123',
      params: { includeDetails: true },
    }));
  });

  it('should attach requestBody correctly for POST method', async () => {
    const mockSpec: OpenAPIV3.Document = {
      openapi: '3.0.0',
      info: { title: 'Test', version: '1.0' },
      servers: [{ url: 'https://api.test.com' }],
      paths: {
        '/posts': {
          post: {
            operationId: 'createPost',
            requestBody: { content: { 'application/json': {} } },
          } as any,
        },
      },
    };

    registryService.getProviderSpec.mockResolvedValue({ 
      providerId: 'test_provider',
      specUrl: 'http://test',
      document: mockSpec, 
      tools: [] 
    });
    (axios as unknown as jest.Mock).mockResolvedValue({ data: { success: true } });

    await service.execute('test_provider', 'createPost', {
      requestBody: { title: 'Hello', content: 'World' },
    });

    expect(axios).toHaveBeenCalledWith(expect.objectContaining({
      method: 'post',
      url: 'https://api.test.com/posts',
      data: { title: 'Hello', content: 'World' },
    }));
  });

  it('should return error DTO if API request fails', async () => {
    const mockSpec: OpenAPIV3.Document = {
      openapi: '3.0.0',
      info: { title: 'Test', version: '1.0' },
      paths: {
        '/fail': {
          get: { operationId: 'getFail' } as any,
        },
      },
    };

    registryService.getProviderSpec.mockResolvedValue({ 
      providerId: 'test_provider',
      specUrl: 'http://test',
      document: mockSpec, 
      tools: [] 
    });
    
    // Simulate HTTP 404
    (axios as unknown as jest.Mock).mockRejectedValue({
      message: 'Request failed with status code 404',
      response: {
        status: 404,
        data: { error: 'Not Found' }
      }
    });

    const result = await service.execute('test_provider', 'getFail', {});

    expect(result.isError).toBe(true);
    expect(result.content![0].text).toContain('Status 404');
    expect(result.content![0].text).toContain('Not Found');
  });

  it('should return error DTO if tool is not found in spec', async () => {
    const mockSpec: OpenAPIV3.Document = {
      openapi: '3.0.0',
      info: { title: 'Test', version: '1.0' },
      paths: {},
    };

    registryService.getProviderSpec.mockResolvedValue({ 
      providerId: 'test_provider',
      specUrl: 'http://test',
      document: mockSpec, 
      tools: [] 
    });

    const result = await service.execute('test_provider', 'unknown_tool', {});

    expect(result.isError).toBe(true);
    expect(result.content![0].text).toContain('not found in spec');
  });
});
