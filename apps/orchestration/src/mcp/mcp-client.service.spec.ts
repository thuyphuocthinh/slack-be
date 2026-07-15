import { Test, TestingModule } from '@nestjs/testing';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { McpClientService } from './mcp-client.service';
import { CircuitBreakerService } from '../common/circuit-breaker.service';
import { DynamicToolRegistryService } from '../registry/dynamic-tool-registry.service';
import { DynamicToolExecutorService } from '../executor/dynamic-tool-executor.service';

const mockConnect = jest.fn();
const mockListTools = jest.fn();
const mockCallTool = jest.fn();
const mockListResources = jest.fn();
const mockListPrompts = jest.fn();
const mockReadResource = jest.fn();
const mockGetPrompt = jest.fn();

jest.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: jest.fn().mockImplementation(() => ({
    connect: mockConnect,
    listTools: mockListTools,
    callTool: mockCallTool,
    listResources: mockListResources,
    listPrompts: mockListPrompts,
    readResource: mockReadResource,
    getPrompt: mockGetPrompt,
  })),
}));

jest.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({
  StreamableHTTPClientTransport: jest.fn(),
}));

jest.mock('../registry/agents.registry', () => ({
  AGENT_REGISTRY: {
    sql_server: {
      label: 'SQL Server',
      endpoint: 'http://mcp-server/mcp/sql_server',
    },
  },
}));

describe('McpClientService', () => {
  let service: McpClientService;
  // Pass-through mặc định — chạy action bình thường, giữ nguyên hành vi các
  // test đã có từ trước Step 6 (chưa có circuit breaker).
  const mockCircuitBreaker = {
    run: jest.fn((_key: string, action: () => Promise<unknown>) => action()),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockConnect.mockResolvedValue(undefined);
    mockCircuitBreaker.run.mockImplementation(
      (_key: string, action: () => Promise<unknown>) => action(),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        McpClientService,
        { provide: CircuitBreakerService, useValue: mockCircuitBreaker },
        {
          provide: DynamicToolRegistryService,
          useValue: { isDynamicProvider: jest.fn().mockReturnValue(false) },
        },
        { provide: DynamicToolExecutorService, useValue: {} },
      ],
    }).compile();

    service = module.get<McpClientService>(McpClientService);
  });

  describe('getTools', () => {
    it('passes through MCP tool annotations (Giai đoạn 3 — Risk Gate cần đọc destructiveHint) untouched', async () => {
      mockListTools.mockResolvedValue({
        tools: [
          {
            name: 'execute_read_only_query',
            description: 'desc',
            inputSchema: {},
            annotations: { readOnlyHint: true },
          },
          {
            name: 'execute_write_query',
            description: 'desc',
            inputSchema: {},
            annotations: { readOnlyHint: false, destructiveHint: true },
          },
        ],
      });

      const tools = await service.getTools('sql_server');

      expect(tools[0].annotations).toEqual({ readOnlyHint: true });
      expect(tools[1].annotations).toEqual({
        readOnlyHint: false,
        destructiveHint: true,
      });
    });

    it('caches the result — a second call within TTL does not call listTools() again', async () => {
      mockListTools.mockResolvedValue({
        tools: [{ name: 'tool_a', description: '', inputSchema: {} }],
      });

      await service.getTools('sql_server');
      await service.getTools('sql_server');

      expect(mockListTools).toHaveBeenCalledTimes(1);
    });

    it('returns an empty list WITHOUT reconnecting when the server genuinely does not implement listTools (JSON-RPC MethodNotFound)', async () => {
      mockListTools.mockRejectedValue(
        new McpError(ErrorCode.MethodNotFound, 'Method not found'),
      );

      const tools = await service.getTools('sql_server');

      expect(tools).toEqual([]);
      // Đúng 1 lần connect (lần đầu) — không reconnect vì đây không phải lỗi
      // kết nối/session, chỉ là server không hỗ trợ tool này.
      expect(mockConnect).toHaveBeenCalledTimes(1);
    });

    it('regression test — reconnects and retries (does NOT silently return an empty list) when listTools fails for a connection/session reason (VD mcp_server vừa restart)', async () => {
      mockListTools
        .mockRejectedValueOnce(new Error('Bad Request: Server not initialized'))
        .mockResolvedValueOnce({
          tools: [{ name: 'get_database_schema', description: '', inputSchema: {} }],
        });

      const tools = await service.getTools('sql_server');

      expect(tools).toEqual([
        { name: 'get_database_schema', description: '', inputSchema: {} },
      ]);
      // Reconnect thật — bug cũ sẽ dừng lại ở đây với mảng RỖNG mà không bao
      // giờ gọi connect() lần 2.
      expect(mockConnect).toHaveBeenCalledTimes(2);
    });

    it('does NOT cache the empty fallback after a connection error is retried successfully — caches the REAL (non-empty) result instead', async () => {
      mockListTools
        .mockRejectedValueOnce(new Error('Bad Request: Server not initialized'))
        .mockResolvedValueOnce({
          tools: [{ name: 'get_database_schema', description: '', inputSchema: {} }],
        });

      await service.getTools('sql_server');
      const secondCall = await service.getTools('sql_server');

      expect(secondCall).toEqual([
        { name: 'get_database_schema', description: '', inputSchema: {} },
      ]);
      // Chỉ 2 lần gọi listTools() tổng cộng (1 lỗi + 1 thành công của LẦN GỌI
      // ĐẦU) — lần gọi thứ 2 tới service.getTools() phải ăn cache, KHÔNG gọi
      // listTools() thêm lần nào nữa.
      expect(mockListTools).toHaveBeenCalledTimes(2);
    });
  });

  describe('getTools — query passthrough for dynamic (Swagger) providers', () => {
    it('forwards the query straight through to DynamicToolRegistryService.getTools, for semantic tool search (Giai đoạn 4 — Tool RAG)', async () => {
      const mockDynamicRegistry = {
        isDynamicProvider: jest.fn().mockResolvedValue(true),
        getTools: jest.fn().mockResolvedValue([]),
      };
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          McpClientService,
          { provide: CircuitBreakerService, useValue: mockCircuitBreaker },
          {
            provide: DynamicToolRegistryService,
            useValue: mockDynamicRegistry,
          },
          { provide: DynamicToolExecutorService, useValue: {} },
        ],
      }).compile();
      const dynamicService = module.get<McpClientService>(McpClientService);

      await dynamicService.getTools(
        'dynamic_provider_1',
        'tôi cần refund đơn hàng',
      );

      expect(mockDynamicRegistry.getTools).toHaveBeenCalledWith(
        'dynamic_provider_1',
        'tôi cần refund đơn hàng',
      );
    });
  });

  describe('callTool', () => {
    it('forwards name/args to the MCP client', async () => {
      mockCallTool.mockResolvedValue({
        content: [{ type: 'text', text: 'ok' }],
      });

      await service.callTool({
        provider: 'sql_server',
        name: 'execute_read_only_query',
        args: { query: 'SELECT 1' },
        ownerId: 'user-1',
      });

      expect(mockCallTool).toHaveBeenCalledWith({
        name: 'execute_read_only_query',
        arguments: { query: 'SELECT 1' },
      });
    });

    it('reconnects and retries exactly once when the first call fails', async () => {
      mockCallTool
        .mockRejectedValueOnce(new Error('Server not initialized'))
        .mockResolvedValueOnce({ content: [] });

      const result = await service.callTool({
        provider: 'sql_server',
        name: 'get_database_schema',
        args: {},
        ownerId: 'user-1',
      });

      expect(result).toEqual({ content: [] });
      expect(mockConnect).toHaveBeenCalledTimes(2);
    });
  });

  describe('Giai đoạn 4, Step 6 — circuit breaker theo provider', () => {
    it('routes callTool() through the breaker keyed by "mcp:<provider>", NOT by ownerId', async () => {
      mockCallTool.mockResolvedValue({ content: [] });

      await service.callTool({
        provider: 'sql_server',
        name: 'x',
        args: {},
        ownerId: 'user-1',
      });

      expect(mockCircuitBreaker.run).toHaveBeenCalledWith(
        'mcp:sql_server',
        expect.any(Function),
      );
    });

    it('routes getTools() through the same breaker key as callTool() for the same provider', async () => {
      mockListTools.mockResolvedValue({ tools: [] });

      await service.getTools('sql_server');

      expect(mockCircuitBreaker.run).toHaveBeenCalledWith(
        'mcp:sql_server',
        expect.any(Function),
      );
    });

    it('propagates a circuit-open rejection straight through, without attempting to connect/call the MCP client', async () => {
      mockCircuitBreaker.run.mockRejectedValueOnce(
        new Error(
          'THIS PROVIDER IS TEMPORARILY UNAVAILABLE (CIRCUIT BREAKER OPEN) (key=mcp:sql_server)',
        ),
      );

      await expect(
        service.callTool({
          provider: 'sql_server',
          name: 'x',
          args: {},
          ownerId: 'user-1',
        }),
      ).rejects.toThrow('CIRCUIT BREAKER OPEN');
      expect(mockConnect).not.toHaveBeenCalled();
      expect(mockCallTool).not.toHaveBeenCalled();
    });
  });

  describe('getResources and getPrompts', () => {
    it('caches the results of getResources and getPrompts', async () => {
      mockListResources.mockResolvedValue({
        resources: [{ uri: 'file://a', name: 'A' }],
      });
      mockListPrompts.mockResolvedValue({
        prompts: [{ name: 'prompt1', description: 'desc' }],
      });

      await service.getResources('sql_server');
      await service.getResources('sql_server');
      expect(mockListResources).toHaveBeenCalledTimes(1);

      await service.getPrompts('sql_server');
      await service.getPrompts('sql_server');
      expect(mockListPrompts).toHaveBeenCalledTimes(1);
    });

    it('getResources: returns [] without reconnecting on genuine MethodNotFound', async () => {
      mockListResources.mockRejectedValue(
        new McpError(ErrorCode.MethodNotFound, 'Method not found'),
      );

      expect(await service.getResources('sql_server')).toEqual([]);
      expect(mockConnect).toHaveBeenCalledTimes(1);
    });

    it('getResources: reconnects and retries on a connection/session error instead of silently returning []', async () => {
      mockListResources
        .mockRejectedValueOnce(new Error('Bad Request: Server not initialized'))
        .mockResolvedValueOnce({ resources: [{ uri: 'file://a', name: 'A' }] });

      const resources = await service.getResources('sql_server');

      expect(resources).toEqual([{ uri: 'file://a', name: 'A' }]);
      expect(mockConnect).toHaveBeenCalledTimes(2);
    });

    it('getPrompts: returns [] without reconnecting on genuine MethodNotFound', async () => {
      mockListPrompts.mockRejectedValue(
        new McpError(ErrorCode.MethodNotFound, 'Method not found'),
      );

      expect(await service.getPrompts('sql_server')).toEqual([]);
      expect(mockConnect).toHaveBeenCalledTimes(1);
    });

    it('getPrompts: reconnects and retries on a connection/session error instead of silently returning []', async () => {
      mockListPrompts
        .mockRejectedValueOnce(new Error('Bad Request: Server not initialized'))
        .mockResolvedValueOnce({ prompts: [{ name: 'prompt1', description: 'desc' }] });

      const prompts = await service.getPrompts('sql_server');

      expect(prompts).toEqual([{ name: 'prompt1', description: 'desc' }]);
      expect(mockConnect).toHaveBeenCalledTimes(2);
    });
  });

  describe('readResource and getPrompt', () => {
    it('reads a resource and formats text contents properly', async () => {
      mockReadResource.mockResolvedValue({
        contents: [
          { text: 'line 1' },
          { blob: 'ignore me' },
          { text: 'line 2' },
        ],
      });

      const text = await service.readResource('sql_server', 'file://test');
      expect(text).toBe('line 1\nline 2');
      expect(mockReadResource).toHaveBeenCalledWith({ uri: 'file://test' });
    });

    it('gets a prompt and returns the full result object', async () => {
      mockGetPrompt.mockResolvedValue({
        description: 'Test',
        messages: [{ role: 'user', content: { type: 'text', text: 'hello' } }],
      });

      const result = await service.getPrompt('sql_server', 'greet', {
        name: 'Alice',
      });
      expect(result.messages[0].content).toEqual({
        type: 'text',
        text: 'hello',
      });
      expect(mockGetPrompt).toHaveBeenCalledWith({
        name: 'greet',
        arguments: { name: 'Alice' },
      });
    });
  });
});
