import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { DynamicToolExecutorService } from './dynamic-tool-executor.service';
import { DynamicToolRegistryService } from '../registry/dynamic-tool-registry.service';
import axios from 'axios';
import { OpenAPIV3 } from 'openapi-types';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
  DynamicProviderEntity,
  EDynamicProviderAuthType,
} from '../entity/dynamic-provider.entity';
import { QueueService } from '@slack/queue';

jest.mock('axios');
jest.mock(
  'nanoid',
  () => ({
    customAlphabet: jest.fn().mockReturnValue(() => 'mocked-id'),
  }),
  { virtual: true },
);

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

    service = module.get<DynamicToolExecutorService>(
      DynamicToolExecutorService,
    );
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
      tools: [],
    });
    (axios as unknown as jest.Mock).mockResolvedValue({
      data: { id: 123, name: 'John' },
    });

    const result = await service.execute('test_provider', 'getUser', {
      userId: 123,
      includeDetails: true,
    });

    expect(result.isError).toBe(false);
    expect(result.content).toHaveLength(1);
    expect(result.content![0].text).toContain('John');

    expect(axios).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'get',
        url: 'https://api.test.com/users/123',
        params: { includeDetails: true },
      }),
    );
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
      tools: [],
    });
    (axios as unknown as jest.Mock).mockResolvedValue({
      data: { success: true },
    });

    await service.execute('test_provider', 'createPost', {
      requestBody: { title: 'Hello', content: 'World' },
    });

    expect(axios).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'post',
        url: 'https://api.test.com/posts',
        data: { title: 'Hello', content: 'World' },
      }),
    );
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
      tools: [],
    });

    // Simulate HTTP 404
    (axios as unknown as jest.Mock).mockRejectedValue({
      message: 'Request failed with status code 404',
      response: {
        status: 404,
        data: { error: 'Not Found' },
      },
    });

    const result = await service.execute('test_provider', 'getFail', {});

    expect(result.isError).toBe(true);
    expect(result.content![0].text).toContain('Status 404');
    expect(result.content![0].text).toContain('Not Found');
    // 404 — lỗi client, KHÔNG thuộc nhóm HTTP status tạm thời (429/502/503/504).
    expect(JSON.parse(result.content![0].text!).retryable).toBe(false);
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
      tools: [],
    });

    const result = await service.execute('test_provider', 'unknown_tool', {});

    expect(result.isError).toBe(true);
    expect(result.content![0].text).toContain('not found in spec');
    expect(JSON.parse(result.content![0].text!).retryable).toBe(false);
  });

  it('redacts sensitive keys in the response via the PII scrub processor', async () => {
    const mockSpec: OpenAPIV3.Document = {
      openapi: '3.0.0',
      info: { title: 'Test', version: '1.0' },
      servers: [{ url: 'https://api.test.com' }],
      paths: {
        '/login': {
          post: { operationId: 'login' } as any,
        },
      },
    };

    registryService.getProviderSpec.mockResolvedValue({
      providerId: 'test_provider',
      specUrl: 'http://test',
      document: mockSpec,
      tools: [],
    });
    (axios as unknown as jest.Mock).mockResolvedValue({
      data: { username: 'johndoe', password: 'MySecretPassword123!' },
    });

    const result = await service.execute('test_provider', 'login', {});

    expect(result.isError).toBe(false);
    expect(result.content![0].text).toContain('johndoe');
    expect(result.content![0].text).toContain('[REDACTED_BY_SECURITY_GATE]');
    expect(result.content![0].text).not.toContain('MySecretPassword123!');
  });

  it('retries a retryable failure (503) and succeeds, without surfacing an error', async () => {
    const mockSpec: OpenAPIV3.Document = {
      openapi: '3.0.0',
      info: { title: 'Test', version: '1.0' },
      servers: [{ url: 'https://api.test.com' }],
      paths: {
        '/flaky': {
          get: { operationId: 'getFlaky' } as any,
        },
      },
    };

    registryService.getProviderSpec.mockResolvedValue({
      providerId: 'test_provider',
      specUrl: 'http://test',
      document: mockSpec,
      tools: [],
    });
    (axios as unknown as jest.Mock)
      .mockRejectedValueOnce({
        response: { status: 503, data: 'Service Unavailable' },
        config: {},
      })
      .mockResolvedValueOnce({ data: { ok: true } });

    const result = await service.execute('test_provider', 'getFlaky', {});

    expect(result.isError).toBe(false);
    expect(result.content![0].text).toContain('"ok": true');
    expect(axios).toHaveBeenCalledTimes(2);
  });

  describe('reactive OAuth2 renew on 401', () => {
    const mockSpec: OpenAPIV3.Document = {
      openapi: '3.0.0',
      info: { title: 'Test', version: '1.0' },
      servers: [{ url: 'https://api.test.com' }],
      paths: {
        '/me': {
          get: { operationId: 'getMe' } as any,
        },
      },
    };

    it('renews the token and retries exactly once after a 401, succeeding without surfacing an error', async () => {
      registryService.getProviderSpec.mockResolvedValue({
        providerId: 'spotify_provider',
        specUrl: 'http://test',
        document: mockSpec,
        tools: [],
        authType: EDynamicProviderAuthType.OAUTH2,
        accessToken: 'stale-access-token',
        refreshToken: 'refresh-token',
        authConfig: {
          tokenUrl: 'https://accounts.spotify.com/api/token',
          clientId: 'cid',
          clientSecret: 'csecret',
        },
      } as any);

      (axios as unknown as jest.Mock)
        .mockRejectedValueOnce({
          response: { status: 401, data: 'Unauthorized' },
          config: {},
        })
        .mockResolvedValueOnce({ data: { ok: true } });
      (axios.post as jest.Mock).mockResolvedValue({
        data: {
          access_token: 'fresh-access-token',
          refresh_token: 'rotated-refresh-token',
          expires_in: 3600,
        },
      });

      const result = await service.execute('spotify_provider', 'getMe', {});

      expect(result.isError).toBe(false);
      expect(result.content![0].text).toContain('"ok": true');
      expect(axios.post).toHaveBeenCalledTimes(1);
      // Retry chỉ xảy ra đúng 1 lần: gọi ban đầu (401) + 1 lần retry sau refresh = 2 lần gọi axios.
      expect(axios).toHaveBeenCalledTimes(2);
    });

    it("routes the refresher's internal logs through the app's NestJS Logger instead of the library's default — regression test for a missing `logger` option", async () => {
      registryService.getProviderSpec.mockResolvedValue({
        providerId: 'spotify_provider',
        specUrl: 'http://test',
        document: mockSpec,
        tools: [],
        authType: EDynamicProviderAuthType.OAUTH2,
        accessToken: 'stale-access-token',
        refreshToken: 'refresh-token',
        authConfig: {
          tokenUrl: 'https://accounts.spotify.com/api/token',
          clientId: 'cid',
          clientSecret: 'csecret',
        },
      } as any);

      (axios as unknown as jest.Mock)
        .mockRejectedValueOnce({
          response: { status: 401, data: 'Unauthorized' },
          config: {},
        })
        .mockResolvedValueOnce({ data: { ok: true } });
      (axios.post as jest.Mock).mockResolvedValue({
        data: { access_token: 'fresh-access-token', expires_in: 3600 },
      });

      const warnSpy = jest.spyOn(Logger.prototype, 'warn');
      const logSpy = jest.spyOn(Logger.prototype, 'log');

      await service.execute('spotify_provider', 'getMe', {});

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('expiring soon'),
      );
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('auto-renewed'),
      );

      warnSpy.mockRestore();
      logSpy.mockRestore();
    });

    it('uses the persisted refreshRequestFormat from authConfig when renewing', async () => {
      registryService.getProviderSpec.mockResolvedValue({
        providerId: 'jira_provider',
        specUrl: 'http://test',
        document: mockSpec,
        tools: [],
        authType: EDynamicProviderAuthType.OAUTH2,
        accessToken: 'stale-access-token',
        refreshToken: 'refresh-token',
        authConfig: {
          tokenUrl: 'https://auth.atlassian.com/oauth/token',
          clientId: 'cid',
          clientSecret: 'csecret',
          refreshRequestFormat: 'json',
        },
      } as any);

      (axios as unknown as jest.Mock)
        .mockRejectedValueOnce({
          response: { status: 401, data: 'Unauthorized' },
          config: {},
        })
        .mockResolvedValueOnce({ data: { ok: true } });
      (axios.post as jest.Mock).mockResolvedValue({
        data: { access_token: 'fresh-access-token', expires_in: 3600 },
      });

      await service.execute('jira_provider', 'getMe', {});

      expect(axios.post).toHaveBeenCalledWith(
        'https://auth.atlassian.com/oauth/token',
        expect.anything(),
        { headers: { 'Content-Type': 'application/json' } },
      );
    });

    it('falls back to auto-detecting the format from tokenUrl when authConfig has no refreshRequestFormat (providers created before this feature)', async () => {
      registryService.getProviderSpec.mockResolvedValue({
        providerId: 'jira_provider_legacy',
        specUrl: 'http://test',
        document: mockSpec,
        tools: [],
        authType: EDynamicProviderAuthType.OAUTH2,
        accessToken: 'stale-access-token',
        refreshToken: 'refresh-token',
        authConfig: {
          tokenUrl: 'https://auth.atlassian.com/oauth/token',
          clientId: 'cid',
          clientSecret: 'csecret',
          // no refreshRequestFormat — pre-existing provider row
        },
      } as any);

      (axios as unknown as jest.Mock)
        .mockRejectedValueOnce({
          response: { status: 401, data: 'Unauthorized' },
          config: {},
        })
        .mockResolvedValueOnce({ data: { ok: true } });
      (axios.post as jest.Mock).mockResolvedValue({
        data: { access_token: 'fresh-access-token', expires_in: 3600 },
      });

      await service.execute('jira_provider_legacy', 'getMe', {});

      expect(axios.post).toHaveBeenCalledWith(
        'https://auth.atlassian.com/oauth/token',
        expect.anything(),
        { headers: { 'Content-Type': 'application/json' } },
      );
    });

    it('uses the persisted responseAccessTokenPath/responseRefreshTokenPath/responseExpiresInPath/defaultExpiresInSecs when renewing against a fully custom internal auth endpoint', async () => {
      registryService.getProviderSpec.mockResolvedValue({
        providerId: 'internal_hr_provider',
        specUrl: 'http://test',
        document: mockSpec,
        tools: [],
        authType: EDynamicProviderAuthType.OAUTH2,
        accessToken: 'stale-access-token',
        refreshToken: 'refresh-token',
        authConfig: {
          tokenUrl: 'https://hr.internal.company.com/auth/refresh',
          responseAccessTokenPath: 'payload.token.at',
          responseRefreshTokenPath: 'payload.token.rt',
          responseExpiresInPath: 'payload.token.ttl',
          defaultExpiresInSecs: 900,
        },
      } as any);

      (axios as unknown as jest.Mock)
        .mockRejectedValueOnce({
          response: { status: 401, data: 'Unauthorized' },
          config: {},
        })
        .mockResolvedValueOnce({ data: { ok: true } });
      (axios.post as jest.Mock).mockResolvedValue({
        data: {
          payload: {
            token: { at: 'fresh-access-token', rt: 'rotated-refresh-token' },
          },
        },
      });

      const result = await service.execute('internal_hr_provider', 'getMe', {});

      expect(result.isError).toBe(false);
      expect(axios).toHaveBeenCalledTimes(2);
    });

    it('does not attempt a renew when the provider has no refreshToken/tokenUrl — surfaces the 401 as-is', async () => {
      registryService.getProviderSpec.mockResolvedValue({
        providerId: 'plain_bearer_provider',
        specUrl: 'http://test',
        document: mockSpec,
        tools: [],
        authType: EDynamicProviderAuthType.BEARER,
        accessToken: 'plain-token',
      } as any);

      (axios as unknown as jest.Mock).mockRejectedValue({
        response: { status: 401, data: 'Unauthorized' },
        config: {},
      });

      const result = await service.execute(
        'plain_bearer_provider',
        'getMe',
        {},
      );

      expect(result.isError).toBe(true);
      expect(result.content![0].text).toContain('Status 401');
      expect(axios.post).not.toHaveBeenCalled();
    });

    it('surfaces the original 401 (without retrying) when the renew itself fails', async () => {
      registryService.getProviderSpec.mockResolvedValue({
        providerId: 'spotify_provider',
        specUrl: 'http://test',
        document: mockSpec,
        tools: [],
        authType: EDynamicProviderAuthType.OAUTH2,
        accessToken: 'stale-access-token',
        refreshToken: 'refresh-token',
        authConfig: {
          tokenUrl: 'https://accounts.spotify.com/api/token',
          clientId: 'wrong-cid',
          clientSecret: 'wrong-csecret',
        },
      } as any);

      (axios as unknown as jest.Mock).mockRejectedValue({
        response: { status: 401, data: 'Unauthorized' },
        config: {},
      });
      (axios.post as jest.Mock).mockRejectedValue(new Error('invalid_client'));

      const result = await service.execute('spotify_provider', 'getMe', {});

      expect(result.isError).toBe(true);
      expect(result.content![0].text).toContain('Status 401');
      // Không retry lại tool call vì renew thất bại — chỉ gọi axios (tool call) đúng 1 lần.
      expect(axios).toHaveBeenCalledTimes(1);
    });
  });

  it('gives up after exhausting retries on a persistently failing call', async () => {
    const mockSpec: OpenAPIV3.Document = {
      openapi: '3.0.0',
      info: { title: 'Test', version: '1.0' },
      servers: [{ url: 'https://api.test.com' }],
      paths: {
        '/always-down': {
          get: { operationId: 'getAlwaysDown' } as any,
        },
      },
    };

    registryService.getProviderSpec.mockResolvedValue({
      providerId: 'test_provider',
      specUrl: 'http://test',
      document: mockSpec,
      tools: [],
    });
    (axios as unknown as jest.Mock).mockRejectedValue({
      response: { status: 503, data: 'Service Unavailable' },
      config: {},
    });

    const result = await service.execute('test_provider', 'getAlwaysDown', {});

    expect(result.isError).toBe(true);
    expect(result.content![0].text).toContain('Status 503');
    // Dù 503 thuộc nhóm HTTP status tạm thời, thư viện ĐÃ tự retry 3 lần thật
    // (initial + maxRetries: 2) và vẫn thất bại — nghĩa là "còn đáng thử lại
    // không" đã được trả lời (KHÔNG) trước khi lỗi này thoát ra. Vì vậy luôn
    // retryable: false ở đây, để react-loop.service.ts không retry chồng thêm
    // lần nữa (tránh nhân 2 tầng retry: 2 orchestration × 3 thư viện = 6 lời
    // gọi HTTP cho 1 lỗi dai dẳng).
    expect(JSON.parse(result.content![0].text!).retryable).toBe(false);
    // Initial attempt + 2 retries (maxRetries: 2), matching the configured retry policy.
    expect(axios).toHaveBeenCalledTimes(3);
  });
});
