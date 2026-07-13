import { Test, TestingModule } from '@nestjs/testing';
import { ProviderSummaryService } from './provider-summary.service';
import { McpAuthClientService } from '../mcp-auth/mcp-auth-client.service';
import { McpClientService } from '../mcp/mcp-client.service';
import { DynamicProviderDbService } from './dynamic-provider-db.service';
import { AGENT_REGISTRY } from './agents.registry';

jest.mock('./agents.registry', () => ({ AGENT_REGISTRY: {} }));

describe('ProviderSummaryService', () => {
  let service: ProviderSummaryService;
  let mcpAuthClient: jest.Mocked<
    Pick<McpAuthClientService, 'getConnectionStatus'>
  >;
  let mcpClient: jest.Mocked<
    Pick<McpClientService, 'getTools' | 'getResources' | 'getPrompts'>
  >;
  let dynamicProviderDb: jest.Mocked<
    Pick<DynamicProviderDbService, 'getProvidersByUser'>
  >;

  beforeEach(async () => {
    // Reset thay vì gán mới — jest.mock ở trên đã cố định tham chiếu module, xoá key thay vì
    // reassign object để mọi import khác của cùng module vẫn thấy đúng thay đổi.
    Object.keys(AGENT_REGISTRY).forEach(
      (key) => delete (AGENT_REGISTRY as any)[key],
    );

    mcpAuthClient = { getConnectionStatus: jest.fn().mockResolvedValue([]) };
    mcpClient = {
      getTools: jest.fn().mockResolvedValue([]),
      getResources: jest.fn().mockResolvedValue([]),
      getPrompts: jest.fn().mockResolvedValue([]),
    };
    dynamicProviderDb = { getProvidersByUser: jest.fn().mockResolvedValue([]) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProviderSummaryService,
        { provide: McpAuthClientService, useValue: mcpAuthClient },
        { provide: McpClientService, useValue: mcpClient },
        { provide: DynamicProviderDbService, useValue: dynamicProviderDb },
      ],
    }).compile();

    service = module.get<ProviderSummaryService>(ProviderSummaryService);
  });

  it('merges static and dynamic provider summaries into a single list', async () => {
    mcpAuthClient.getConnectionStatus.mockResolvedValue([
      {
        provider_id: 'notion',
        is_connected: true,
        status: 'connected',
        connected_at: null,
      },
    ]);
    dynamicProviderDb.getProvidersByUser.mockResolvedValue([
      {
        id: 'dynamic_abc',
        userId: 'user-1',
        name: 'Jira',
        specUrl: 'https://example.com/spec.json',
        hasAuth: true,
        authType: 'BEARER',
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any,
    ]);

    const result = await service.getProviders('user-1');

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      provider: 'notion',
      isDynamic: false,
      isConnected: true,
    });
    expect(result[1]).toMatchObject({
      provider: 'dynamic_abc',
      isDynamic: true,
      hasAuth: true,
    });
  });

  it('fetches tools/resources/prompts for a static provider that has a registered agent endpoint', async () => {
    (AGENT_REGISTRY as any).sql_server = {
      label: 'SQL Server',
      endpoint: 'http://agent.internal',
    };
    mcpAuthClient.getConnectionStatus.mockResolvedValue([
      {
        provider_id: 'sql_server',
        is_connected: true,
        status: 'connected',
        connected_at: null,
      },
    ]);
    mcpClient.getTools.mockResolvedValue([{ name: 'query' } as any]);

    const result = await service.getProviders('user-1');

    expect(mcpClient.getTools).toHaveBeenCalledWith('sql_server');
    expect(mcpClient.getResources).toHaveBeenCalledWith('sql_server');
    expect(mcpClient.getPrompts).toHaveBeenCalledWith('sql_server');
    expect(result[0].tools).toEqual([{ name: 'query' }]);
  });

  it('skips fetching tools/resources/prompts for a static provider with no registered agent endpoint', async () => {
    mcpAuthClient.getConnectionStatus.mockResolvedValue([
      {
        provider_id: 'notion',
        is_connected: true,
        status: 'connected',
        connected_at: null,
      },
    ]);

    const result = await service.getProviders('user-1');

    expect(mcpClient.getTools).not.toHaveBeenCalled();
    expect(result[0].tools).toEqual([]);
  });

  it('falls back to empty tools/resources/prompts for a static provider when the MCP call fails', async () => {
    (AGENT_REGISTRY as any).sql_server = {
      label: 'SQL Server',
      endpoint: 'http://agent.internal',
    };
    mcpAuthClient.getConnectionStatus.mockResolvedValue([
      {
        provider_id: 'sql_server',
        is_connected: true,
        status: 'connected',
        connected_at: null,
      },
    ]);
    mcpClient.getTools.mockRejectedValue(new Error('agent unreachable'));

    const result = await service.getProviders('user-1');

    expect(result[0].tools).toEqual([]);
    expect(result[0].resources).toEqual([]);
    expect(result[0].prompts).toEqual([]);
  });

  it('falls back to an empty tools list for a dynamic provider when the MCP call fails, without throwing', async () => {
    dynamicProviderDb.getProvidersByUser.mockResolvedValue([
      {
        id: 'dynamic_abc',
        userId: 'user-1',
        name: 'Jira',
        specUrl: 'https://example.com/spec.json',
        hasAuth: true,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any,
    ]);
    mcpClient.getTools.mockRejectedValue(new Error('spec unreachable'));

    const result = await service.getProviders('user-1');

    expect(result[0].tools).toEqual([]);
  });

  it("falls back the dynamic provider's description to a generic Swagger label when none was given", async () => {
    dynamicProviderDb.getProvidersByUser.mockResolvedValue([
      {
        id: 'dynamic_abc',
        userId: 'user-1',
        name: 'Jira',
        specUrl: 'https://example.com/spec.json',
        hasAuth: false,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any,
    ]);

    const result = await service.getProviders('user-1');

    expect(result[0].description).toBe(
      'Custom Swagger API: https://example.com/spec.json',
    );
  });

  it('forwards authType and the granular hasAccessToken/hasRefreshToken/hasTokenUrl booleans for a dynamic provider — regression test for the reconnect dialog defaulting to the wrong authType because these were previously dropped', async () => {
    dynamicProviderDb.getProvidersByUser.mockResolvedValue([
      {
        id: 'dynamic_abc',
        userId: 'user-1',
        name: 'Jira',
        specUrl: 'https://example.com/spec.json',
        hasAuth: true,
        authType: 'OAUTH2',
        hasAccessToken: false,
        hasRefreshToken: true,
        hasTokenUrl: true,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any,
    ]);

    const result = await service.getProviders('user-1');

    expect(result[0]).toMatchObject({
      authType: 'OAUTH2',
      hasAccessToken: false,
      hasRefreshToken: true,
      hasTokenUrl: true,
    });
  });
});
