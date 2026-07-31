import { Test, TestingModule } from '@nestjs/testing';
import { OpenApiParserService } from './openapi-parser.service';
import { RpcException } from '@nestjs/microservices';
import { ORCHESTRATION_ERROR } from '@slack/constants';
import SwaggerParser from '@apidevtools/swagger-parser';
import { OpenAPI } from 'openapi-types';

// Mock SwaggerParser to avoid actual network/file requests during testing
jest.mock('@apidevtools/swagger-parser');

describe('OpenApiParserService', () => {
  let service: OpenApiParserService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [OpenApiParserService],
    }).compile();

    service = module.get<OpenApiParserService>(OpenApiParserService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('loadSpec', () => {
    it('should successfully parse, dereference and validate a valid spec', async () => {
      const mockSpec: Partial<OpenAPI.Document> = {
        openapi: '3.0.0',
        info: { title: 'Test API', version: '1.0.0' },
        paths: {},
      };

      (SwaggerParser.validate as jest.Mock).mockResolvedValue(mockSpec);

      const url = 'http://example.com/swagger.json';
      const result = await service.loadSpec(url);

      expect(SwaggerParser.validate).toHaveBeenCalledWith(
        url,
        expect.objectContaining({
          resolve: { http: { read: expect.any(Function) } },
        }),
      );
      expect(result).toEqual(mockSpec);
    });

    it('should throw BadRequestException when parsing fails', async () => {
      const errorMessage = 'Network error or invalid JSON';
      (SwaggerParser.validate as jest.Mock).mockRejectedValue(
        new Error(errorMessage),
      );

      const url = 'invalid-url';

      await expect(service.loadSpec(url)).rejects.toThrow(RpcException);
      await expect(service.loadSpec(url)).rejects.toMatchObject({
        error: expect.objectContaining({
          code: ORCHESTRATION_ERROR.INVALID_OPENAPI_SPEC.code,
        }),
      });
    });
  });
});
