import { Test, TestingModule } from '@nestjs/testing';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { ORCHESTRATION_CONSTANTS } from '@slack/constants';
import { McpClientService } from './mcp-client.service';
import { CircuitBreakerService } from '../common/circuit-breaker.service';
import { ProviderConcurrencyLimiterService } from '../common/provider-concurrency-limiter.service';
import { DynamicToolRegistryService } from '../registry/dynamic-tool-registry.service';
import { DynamicToolExecutorService } from '../executor/dynamic-tool-executor.service';
import { EdgeRelayRegistryService } from '../edge-relay/edge-relay-registry.service';
import { RelayOfflineError } from '../edge-relay/relay-offline.error';
import { RelayTimeoutError } from '../edge-relay/relay-timeout.error';
import { RelayClientTransport } from './relay-client.transport';

const mockConnect = jest.fn();
const mockListTools = jest.fn();
const mockCallTool = jest.fn();
const mockListResources = jest.fn();
const mockListPrompts = jest.fn();
const mockReadResource = jest.fn();
const mockGetPrompt = jest.fn();
const mockClose = jest.fn();

jest.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: jest.fn().mockImplementation(() => ({
    connect: mockConnect,
    listTools: mockListTools,
    callTool: mockCallTool,
    listResources: mockListResources,
    listPrompts: mockListPrompts,
    readResource: mockReadResource,
    getPrompt: mockGetPrompt,
    close: mockClose,
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
    // Edge MCP Server plan, Phase 1 — provider giả lập có 1 instance riêng
    // cho mỗi workspace (VD relay on-prem), dùng để test cache/breaker/limiter
    // có tách đúng theo workspaceId hay không, KHÔNG ảnh hưởng behavior của
    // sql_server (provider dùng chung, không set perWorkspaceInstance).
    edge_relay_test: {
      label: 'Edge Relay Test',
      endpoint: 'http://mcp-server/mcp/edge_relay_test',
      perWorkspaceInstance: true,
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
  const mockEdgeRelayRegistry = {
    bind: jest.fn(),
    unbind: jest.fn(),
    isOnline: jest.fn(),
    dispatch: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockConnect.mockResolvedValue(undefined);
    mockClose.mockResolvedValue(undefined);
    // Mặc định: danh sách tool rỗng — callTool() giờ tự tra getTools() để biết
    // destructiveHint TRƯỚC khi quyết định số lần retry (xem callTool()); test
    // nào cần khai báo tool cụ thể (VD destructiveHint: true) sẽ tự override.
    mockListTools.mockResolvedValue({ tools: [] });
    mockCircuitBreaker.run.mockImplementation(
      (_key: string, action: () => Promise<unknown>) => action(),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        McpClientService,
        { provide: CircuitBreakerService, useValue: mockCircuitBreaker },
        ProviderConcurrencyLimiterService,
        {
          provide: DynamicToolRegistryService,
          useValue: { isDynamicProvider: jest.fn().mockReturnValue(false) },
        },
        { provide: DynamicToolExecutorService, useValue: {} },
        { provide: EdgeRelayRegistryService, useValue: mockEdgeRelayRegistry },
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
          tools: [
            { name: 'get_database_schema', description: '', inputSchema: {} },
          ],
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
          tools: [
            { name: 'get_database_schema', description: '', inputSchema: {} },
          ],
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
          ProviderConcurrencyLimiterService,
          {
            provide: DynamicToolRegistryService,
            useValue: mockDynamicRegistry,
          },
          { provide: DynamicToolExecutorService, useValue: {} },
          {
            provide: EdgeRelayRegistryService,
            useValue: mockEdgeRelayRegistry,
          },
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

    // Bug thật đã sửa (Stop giữa turn) — trước đây callTool() không truyền
    // signal cho nhánh dynamic provider, nên Stop vô tác dụng khi đang gọi 1
    // dynamic tool. agentic-openapi-parser@1.8.0+ hỗ trợ AbortSignal.
    it('forwards the Stop-cancellation signal to the dynamic provider executor too', async () => {
      const mockDynamicRegistry = {
        isDynamicProvider: jest.fn().mockResolvedValue(true),
      };
      const mockDynamicExecutor = {
        execute: jest.fn().mockResolvedValue({ content: [] }),
      };
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          McpClientService,
          { provide: CircuitBreakerService, useValue: mockCircuitBreaker },
          ProviderConcurrencyLimiterService,
          {
            provide: DynamicToolRegistryService,
            useValue: mockDynamicRegistry,
          },
          {
            provide: DynamicToolExecutorService,
            useValue: mockDynamicExecutor,
          },
          {
            provide: EdgeRelayRegistryService,
            useValue: mockEdgeRelayRegistry,
          },
        ],
      }).compile();
      const dynamicService = module.get<McpClientService>(McpClientService);
      const controller = new AbortController();

      await dynamicService.callTool(
        {
          provider: 'dynamic_provider_1',
          name: 'findPetsByStatus',
          args: { status: 'available' },
          ownerId: 'user-1',
        },
        controller.signal,
      );

      expect(mockDynamicExecutor.execute).toHaveBeenCalledWith(
        'dynamic_provider_1',
        'findPetsByStatus',
        { status: 'available' },
        'user-1',
        controller.signal,
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

      expect(mockCallTool).toHaveBeenCalledWith(
        { name: 'execute_read_only_query', arguments: { query: 'SELECT 1' } },
        undefined,
        { signal: undefined },
      );
    });

    it('accuracy_problem.md — forwards the Stop-cancellation signal to the MCP client (huỷ được cả lúc đang chạy tool call, không chỉ lúc LLM đang stream)', async () => {
      mockCallTool.mockResolvedValue({
        content: [{ type: 'text', text: 'ok' }],
      });
      const controller = new AbortController();

      await service.callTool(
        {
          provider: 'sql_server',
          name: 'execute_read_only_query',
          args: { query: 'SELECT 1' },
          ownerId: 'user-1',
        },
        controller.signal,
      );

      expect(mockCallTool).toHaveBeenCalledWith(expect.anything(), undefined, {
        signal: controller.signal,
      });
    });

    it('reconnects and retries exactly once when the first call fails', async () => {
      // Mồi thẳng cache tool (không qua getTools() thật — tránh tốn thêm 1
      // connect() không liên quan tới test này) để callTool() biết đây KHÔNG
      // phải tool nguy hiểm, giữ nguyên hành vi retry như cũ.
      (service as any).toolsCache.set('sql_server', {
        data: [],
        fetchedAt: Date.now(),
      });
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

    // Bug thật đã sửa: Stop giữa turn trước đây không cắt được lúc đang chạy
    // tool call/retry — người dùng phải đợi hết vòng retry rồi mới thấy Stop
    // có tác dụng.
    it('không thử lại (throw ngay) khi signal ĐÃ bị abort TRƯỚC KHI thực hiện lần gọi tiếp theo', async () => {
      (service as any).toolsCache.set('sql_server', {
        data: [],
        fetchedAt: Date.now(),
      });
      const controller = new AbortController();
      mockCallTool.mockImplementation(() => {
        // Mô phỏng đúng kịch bản thật: Stop xảy ra NGAY LÚC lỗi đầu tiên xảy
        // ra, trước khi vòng lặp kịp xét tới lần thử tiếp theo.
        controller.abort();
        return Promise.reject(new Error('Server not initialized'));
      });

      await expect(
        service.callTool(
          {
            provider: 'sql_server',
            name: 'get_database_schema',
            args: {},
            ownerId: 'user-1',
          },
          controller.signal,
        ),
      ).rejects.toThrow('Server not initialized');

      // Đúng 1 lần gọi thật — không retry thêm sau khi đã bị huỷ.
      expect(mockCallTool).toHaveBeenCalledTimes(1);
    });

    it('throw "Aborted" ngay lập tức, không gọi tool nào, khi signal đã bị abort TỪ TRƯỚC khi callTool() bắt đầu', async () => {
      (service as any).toolsCache.set('sql_server', {
        data: [],
        fetchedAt: Date.now(),
      });
      const controller = new AbortController();
      controller.abort();

      await expect(
        service.callTool(
          {
            provider: 'sql_server',
            name: 'get_database_schema',
            args: {},
            ownerId: 'user-1',
          },
          controller.signal,
        ),
      ).rejects.toThrow('Aborted');

      expect(mockCallTool).not.toHaveBeenCalled();
    });

    it('does NOT retry a destructive (non-idempotent) tool — a timeout/error might mean it already ran server-side, so blind retry risks duplicating the write', async () => {
      mockListTools.mockResolvedValue({
        tools: [
          {
            name: 'execute_write_query',
            description: 'desc',
            inputSchema: {},
            annotations: { readOnlyHint: false, destructiveHint: true },
          },
        ],
      });
      mockCallTool.mockRejectedValue(new Error('ETIMEDOUT'));

      await expect(
        service.callTool({
          provider: 'sql_server',
          name: 'execute_write_query',
          args: { query: "UPDATE Orders SET Status='Completed'" },
          ownerId: 'user-1',
        }),
      ).rejects.toThrow('ETIMEDOUT');

      // Đúng 1 lần gọi tool thật — KHÔNG retry, tránh nguy cơ ghi trùng.
      expect(mockCallTool).toHaveBeenCalledTimes(1);
    });

    it('treats a tool as destructive when the cache exists but does not contain that tool (renamed/schema-drift) — fail-safe, not fail-open', async () => {
      (service as any).toolsCache.set('sql_server', {
        data: [
          { name: 'get_database_schema', description: '', inputSchema: {} },
        ],
        fetchedAt: Date.now(),
      });
      mockCallTool.mockRejectedValue(new Error('ETIMEDOUT'));

      await expect(
        service.callTool({
          provider: 'sql_server',
          name: 'execute_write_query',
          args: { query: 'DELETE FROM Orders' },
          ownerId: 'user-1',
        }),
      ).rejects.toThrow('ETIMEDOUT');

      expect(mockCallTool).toHaveBeenCalledTimes(1);
    });

    it('bug fix — treats a tool as destructive when the cached annotation is older than the TTL, instead of trusting a stale "safe" snapshot', async () => {
      (service as any).toolsCache.set('sql_server', {
        data: [
          {
            name: 'execute_write_query',
            description: '',
            inputSchema: {},
            annotations: { readOnlyHint: false, destructiveHint: false },
          },
        ],
        fetchedAt:
          Date.now() - ORCHESTRATION_CONSTANTS.MCP_TOOLS_CACHE_TTL_MS - 1000,
      });
      mockCallTool.mockRejectedValue(new Error('ETIMEDOUT'));

      await expect(
        service.callTool({
          provider: 'sql_server',
          name: 'execute_write_query',
          args: { query: 'DELETE FROM Orders' },
          ownerId: 'user-1',
        }),
      ).rejects.toThrow('ETIMEDOUT');

      expect(mockCallTool).toHaveBeenCalledTimes(1);
    });

    it('DOES retry a destructive tool exactly once on a stale-session error — mcp_server restart means the request was rejected at the transport layer, before it ever reached the tool handler, so retrying is provably safe', async () => {
      mockListTools.mockResolvedValue({
        tools: [
          {
            name: 'execute_write_query',
            description: 'desc',
            inputSchema: {},
            annotations: { readOnlyHint: false, destructiveHint: true },
          },
        ],
      });
      mockCallTool
        .mockRejectedValueOnce(new McpError(-32001, 'Session not found'))
        .mockResolvedValueOnce({ content: [] });

      const result = await service.callTool({
        provider: 'sql_server',
        name: 'execute_write_query',
        args: {
          query: "INSERT INTO Products VALUES ('a'),('b'),('c'),('d'),('e')",
        },
        ownerId: 'user-1',
      });

      expect(result).toEqual({ content: [] });
      expect(mockCallTool).toHaveBeenCalledTimes(2);
    });

    it('does NOT retry a destructive tool a second time even if the stale-session error keeps recurring — the bonus retry is spent exactly once per call', async () => {
      mockListTools.mockResolvedValue({
        tools: [
          {
            name: 'execute_write_query',
            description: 'desc',
            inputSchema: {},
            annotations: { readOnlyHint: false, destructiveHint: true },
          },
        ],
      });
      mockCallTool.mockRejectedValue(new McpError(-32001, 'Session not found'));

      await expect(
        service.callTool({
          provider: 'sql_server',
          name: 'execute_write_query',
          args: { query: 'INSERT INTO Products VALUES (1)' },
          ownerId: 'user-1',
        }),
      ).rejects.toThrow('Session not found');

      // maxRetries=1 (destructive) + đúng 1 bonus retry session-chết = tối đa
      // 2 lần gọi tool thật, không lặp vô hạn dù lỗi cứ lặp lại.
      expect(mockCallTool).toHaveBeenCalledTimes(2);
    });

    it('still retries a safe (read-only) tool as before — no side effect risk', async () => {
      // Mồi thẳng cache (không qua getTools() thật — tránh tốn thêm 1 connect()
      // không liên quan tới test này), đúng như ReactLoop đã getTools() trước
      // khi callTool() trong luồng thật.
      (service as any).toolsCache.set('sql_server', {
        data: [
          {
            name: 'execute_read_only_query',
            description: 'desc',
            inputSchema: {},
            annotations: { readOnlyHint: true },
          },
        ],
        fetchedAt: Date.now(),
      });
      mockCallTool
        .mockRejectedValueOnce(new Error('ETIMEDOUT'))
        .mockResolvedValueOnce({ content: [] });

      const result = await service.callTool({
        provider: 'sql_server',
        name: 'execute_read_only_query',
        args: { query: 'SELECT 1' },
        ownerId: 'user-1',
      });

      expect(result).toEqual({ content: [] });
      expect(mockCallTool).toHaveBeenCalledTimes(2);
    });

    it('defaults to NOT retrying (safe choice) when the tool list was never cached for this provider, instead of forcing an extra fetch/connection just to check', async () => {
      // KHÔNG mồi cache (khác test trên) — mô phỏng gọi callTool() mà chưa
      // từng getTools() cho provider này trước đó.
      mockCallTool.mockRejectedValue(new Error('ETIMEDOUT'));

      await expect(
        service.callTool({
          provider: 'sql_server',
          name: 'execute_write_query',
          args: {},
          ownerId: 'user-1',
        }),
      ).rejects.toThrow('ETIMEDOUT');

      expect(mockCallTool).toHaveBeenCalledTimes(1);
    });
  });

  describe('callWithReconnect() timeout vs connection-error retry (bug: đọc dữ liệu lớn bị timeout)', () => {
    it('does NOT retry when the error IS the client-side watchdog timeout (withTimeout tự bỏ cuộc chờ) — retrying the identical slow call vào ĐÚNG cùng ngưỡng thời gian không giúp được gì', async () => {
      (service as any).toolsCache.set('sql_server', {
        data: [
          {
            name: 'execute_read_only_query',
            description: '',
            inputSchema: {},
            annotations: { readOnlyHint: true },
          },
        ],
        fetchedAt: Date.now(),
      });
      // Đúng NGUYÊN VĂN message callWithReconnect() tự sinh cho watchdog
      // timeout của chính nó — mô phỏng thẳng tín hiệu này (không cần chờ
      // 30s thật/fake timer) để test isTimeoutError() nhận diện đúng.
      mockCallTool.mockRejectedValue(
        new Error(
          `MCP call timeout sau ${ORCHESTRATION_CONSTANTS.MCP_CALL_TIMEOUT_MS / 1000}s (sql_server:user-1)`,
        ),
      );

      await expect(
        service.callTool({
          provider: 'sql_server',
          name: 'execute_read_only_query',
          args: { query: 'SELECT * FROM HugeTable' },
          ownerId: 'user-1',
        }),
      ).rejects.toThrow('MCP call timeout');

      // Đúng 1 lần gọi thật — không reconnect, không retry lần 2/3 dù tool
      // đọc vốn cho phép maxRetries=3 cho lỗi kết nối/session.
      expect(mockCallTool).toHaveBeenCalledTimes(1);
      expect(mockConnect).toHaveBeenCalledTimes(1);
    });

    it('vẫn retry như cũ khi lỗi là kết nối/session THẬT (KHÔNG phải watchdog timeout của chính mình) — quy tắc cũ không đổi', async () => {
      (service as any).toolsCache.set('sql_server', {
        data: [
          {
            name: 'execute_read_only_query',
            description: '',
            inputSchema: {},
            annotations: { readOnlyHint: true },
          },
        ],
        fetchedAt: Date.now(),
      });
      mockCallTool
        .mockRejectedValueOnce(new Error('ETIMEDOUT'))
        .mockResolvedValueOnce({ content: [] });

      const result = await service.callTool({
        provider: 'sql_server',
        name: 'execute_read_only_query',
        args: { query: 'SELECT 1' },
        ownerId: 'user-1',
      });

      expect(result).toEqual({ content: [] });
      expect(mockCallTool).toHaveBeenCalledTimes(2);
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
        undefined,
      );
    });

    it('routes getTools() through the same breaker key as callTool() for the same provider', async () => {
      mockListTools.mockResolvedValue({ tools: [] });

      await service.getTools('sql_server');

      expect(mockCircuitBreaker.run).toHaveBeenCalledWith(
        'mcp:sql_server',
        expect.any(Function),
        undefined,
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
        .mockResolvedValueOnce({
          prompts: [{ name: 'prompt1', description: 'desc' }],
        });

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

    describe('accuracy_problem.md mục 9.4 — resource content cache', () => {
      afterEach(() => jest.useRealTimers());

      it('does not re-read the same (provider, uri) from the MCP server within MCP_RESOURCE_CONTENT_CACHE_TTL_MS', async () => {
        mockReadResource.mockResolvedValue({ contents: [{ text: 'line 1' }] });

        const first = await service.readResource('sql_server', 'file://test');
        const second = await service.readResource('sql_server', 'file://test');

        expect(first).toBe('line 1');
        expect(second).toBe('line 1');
        expect(mockReadResource).toHaveBeenCalledTimes(1);
      });

      it('treats a different uri (same provider) as a separate cache entry — still reads it live', async () => {
        mockReadResource.mockResolvedValue({ contents: [{ text: 'line 1' }] });

        await service.readResource('sql_server', 'file://a');
        await service.readResource('sql_server', 'file://b');

        expect(mockReadResource).toHaveBeenCalledTimes(2);
      });

      it("bug thật đã tự gây ra — NEVER serves user A's cached content to user B for the SAME (provider, uri): cache key phải bao gồm ownerId", async () => {
        mockReadResource
          .mockResolvedValueOnce({
            contents: [{ text: 'nội dung của user A' }],
          })
          .mockResolvedValueOnce({
            contents: [{ text: 'nội dung của user B' }],
          });

        const forUserA = await service.readResource(
          'sql_server',
          'file://shared-uri',
          'user-A',
        );
        const forUserB = await service.readResource(
          'sql_server',
          'file://shared-uri',
          'user-B',
        );

        expect(forUserA).toBe('nội dung của user A');
        expect(forUserB).toBe('nội dung của user B');
        // Mỗi user phải đọc LIVE riêng — không được lẫn cache của nhau.
        expect(mockReadResource).toHaveBeenCalledTimes(2);
      });

      it('still caches per-user across repeated calls (same provider, same uri, same ownerId)', async () => {
        mockReadResource.mockResolvedValue({
          contents: [{ text: 'nội dung A' }],
        });

        await service.readResource('sql_server', 'file://shared-uri', 'user-A');
        await service.readResource('sql_server', 'file://shared-uri', 'user-A');

        expect(mockReadResource).toHaveBeenCalledTimes(1);
      });

      it('re-reads from the MCP server after MCP_RESOURCE_CONTENT_CACHE_TTL_MS elapses', async () => {
        jest.useFakeTimers();
        mockReadResource.mockResolvedValue({ contents: [{ text: 'line 1' }] });

        await service.readResource('sql_server', 'file://test');
        jest.advanceTimersByTime(
          ORCHESTRATION_CONSTANTS.MCP_RESOURCE_CONTENT_CACHE_TTL_MS + 1000,
        );
        await service.readResource('sql_server', 'file://test');

        expect(mockReadResource).toHaveBeenCalledTimes(2);
      });

      it('does not re-read within TTL (rất ngắn so với TTL)', async () => {
        jest.useFakeTimers();
        mockReadResource.mockResolvedValue({ contents: [{ text: 'line 1' }] });

        await service.readResource('sql_server', 'file://test');
        jest.advanceTimersByTime(1000);
        await service.readResource('sql_server', 'file://test');

        expect(mockReadResource).toHaveBeenCalledTimes(1);
      });
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

  describe('getClient() connection race (Giai đoạn System, mục 5.1)', () => {
    it('shares a single in-flight connect() across 2 concurrent calls for the same provider+ownerId, instead of each creating its own (orphaned) connection', async () => {
      let resolveConnect!: () => void;
      mockConnect.mockImplementation(
        () => new Promise<void>((resolve) => (resolveConnect = resolve)),
      );
      mockCallTool.mockResolvedValue({ content: [] });

      const call = () =>
        service.callTool({
          provider: 'sql_server',
          name: 'x',
          args: {},
          ownerId: 'user-1',
        });

      const p1 = call();
      const p2 = call();
      // Nhường đủ tick cho cả 2 lệnh gọi cùng chạy tới bước connect() đang treo.
      await new Promise((resolve) => setTimeout(resolve, 0));

      // Trước fix: cache lưu Client đã resolve — cả 2 sẽ thấy cache trống và
      // TỰ connect() riêng (2 lần). Sau fix: cache lưu Promise đang connect —
      // request thứ 2 await CHUNG promise của request thứ 1.
      expect(mockConnect).toHaveBeenCalledTimes(1);

      resolveConnect();
      await Promise.all([p1, p2]);

      expect(mockCallTool).toHaveBeenCalledTimes(2);
    });

    it('does not cache a failed connect() forever — the next call retries instead of reusing a rejected promise', async () => {
      (service as any).toolsCache.set('sql_server', {
        data: [{ name: 'x', description: '', inputSchema: {} }],
        fetchedAt: Date.now(),
      });
      mockConnect
        .mockRejectedValueOnce(new Error('ECONNREFUSED'))
        .mockResolvedValueOnce(undefined);
      mockCallTool.mockResolvedValue({ content: [] });

      await service.callTool({
        provider: 'sql_server',
        name: 'x',
        args: {},
        ownerId: 'user-1',
      });

      // callWithReconnect() tự retry nội bộ khi connect lỗi — 2 lần connect
      // TRONG CÙNG 1 lời gọi callTool() (lỗi rồi thử lại), không phải do cache.
      expect(mockConnect).toHaveBeenCalledTimes(2);
    });
  });

  describe('evictIdleClients (Giai đoạn System, mục 5.3)', () => {
    afterEach(() => jest.useRealTimers());

    it('closes and evicts a client that has been idle past MCP_CLIENT_IDLE_TTL_MS', async () => {
      jest.useFakeTimers();
      mockCallTool.mockResolvedValue({ content: [] });

      await service.callTool({
        provider: 'sql_server',
        name: 'x',
        args: {},
        ownerId: 'user-1',
      });
      expect(mockConnect).toHaveBeenCalledTimes(1);

      jest.advanceTimersByTime(
        ORCHESTRATION_CONSTANTS.MCP_CLIENT_IDLE_TTL_MS + 1000,
      );
      await service.evictIdleClients();

      expect(mockClose).toHaveBeenCalledTimes(1);

      // Cache đã bị xoá — lần gọi kế tiếp phải reconnect thật, không dùng lại
      // client cũ đã đóng.
      await service.callTool({
        provider: 'sql_server',
        name: 'x',
        args: {},
        ownerId: 'user-1',
      });
      expect(mockConnect).toHaveBeenCalledTimes(2);
    });

    it('does not evict a client that was used recently (within TTL)', async () => {
      jest.useFakeTimers();
      mockCallTool.mockResolvedValue({ content: [] });

      await service.callTool({
        provider: 'sql_server',
        name: 'x',
        args: {},
        ownerId: 'user-1',
      });

      jest.advanceTimersByTime(1000); // rất ngắn so với TTL 30 phút
      await service.evictIdleClients();

      expect(mockClose).not.toHaveBeenCalled();

      await service.callTool({
        provider: 'sql_server',
        name: 'x',
        args: {},
        ownerId: 'user-1',
      });
      // Vẫn dùng lại đúng client cũ — không reconnect.
      expect(mockConnect).toHaveBeenCalledTimes(1);
    });

    it('refreshes lastUsedAt on every use — a client kept busy is never evicted, even past TTL since its FIRST use', async () => {
      jest.useFakeTimers();
      mockCallTool.mockResolvedValue({ content: [] });

      await service.callTool({
        provider: 'sql_server',
        name: 'x',
        args: {},
        ownerId: 'user-1',
      });
      // "Dùng lại" gần hết TTL — phải cập nhật lastUsedAt, không tính idle từ mốc connect() ban đầu.
      jest.advanceTimersByTime(
        ORCHESTRATION_CONSTANTS.MCP_CLIENT_IDLE_TTL_MS - 1000,
      );
      await service.callTool({
        provider: 'sql_server',
        name: 'x',
        args: {},
        ownerId: 'user-1',
      });

      jest.advanceTimersByTime(2000); // vượt TTL kể từ mốc connect() gốc, nhưng chưa vượt kể từ lần dùng gần nhất
      await service.evictIdleClients();

      expect(mockClose).not.toHaveBeenCalled();
      expect(mockConnect).toHaveBeenCalledTimes(1);
    });
  });

  describe('Bug fix #2 — PII scrubbing for static MCP providers (callTool)', () => {
    it('masks email addresses in text content returned by static providers', async () => {
      mockCallTool.mockResolvedValue({
        content: [
          { type: 'text', text: 'User john.doe@example.com placed an order' },
        ],
        isError: false,
      });

      const result = await service.callTool({
        provider: 'sql_server',
        name: 'execute_read_only_query',
        args: { query: 'SELECT * FROM users' },
        ownerId: 'user-1',
      });

      const text = (result.content?.[0] as { type: string; text: string }).text;
      expect(text).not.toContain('john.doe@example.com');
      // Should be masked like j***e@example.com
      expect(text).toContain('@example.com');
    });

    it('masks credit card numbers in tool results', async () => {
      mockCallTool.mockResolvedValue({
        content: [
          {
            type: 'text',
            text: 'Card: 4111-1111-1111-1111 charged successfully',
          },
        ],
        isError: false,
      });

      const result = await service.callTool({
        provider: 'sql_server',
        name: 'execute_read_only_query',
        args: { query: 'SELECT * FROM payments' },
        ownerId: 'user-1',
      });

      const text = (result.content?.[0] as { type: string; text: string }).text;
      expect(text).not.toContain('4111-1111-1111-1111');
      expect(text).toContain('****-****-****-');
    });

    it('passes through non-text content items without modification', async () => {
      const blobItem = { type: 'blob', data: 'base64data' };
      mockCallTool.mockResolvedValue({
        content: [blobItem],
        isError: false,
      });

      const result = await service.callTool({
        provider: 'sql_server',
        name: 'execute_read_only_query',
        args: {},
        ownerId: 'user-1',
      });

      expect(result.content?.[0]).toEqual(blobItem);
    });

    it('preserves isError flag after scrubbing', async () => {
      mockCallTool.mockResolvedValue({
        content: [{ type: 'text', text: 'error: user@example.com not found' }],
        isError: true,
      });

      const result = await service.callTool({
        provider: 'sql_server',
        name: 'execute_read_only_query',
        args: {},
        ownerId: 'user-1',
      });

      expect(result.isError).toBe(true);
    });

    it('does not scrub dynamic provider results (those go through DynamicToolExecutorService which already has PiiScrubProcessor)', async () => {
      const mockDynamicRegistry2 = {
        isDynamicProvider: jest.fn().mockResolvedValue(true),
      };
      const mockDynamicExecutor2 = {
        execute: jest.fn().mockResolvedValue({
          content: [{ type: 'text', text: 'user@example.com' }],
          isError: false,
        }),
      };
      const module2: TestingModule = await Test.createTestingModule({
        providers: [
          McpClientService,
          { provide: CircuitBreakerService, useValue: mockCircuitBreaker },
          ProviderConcurrencyLimiterService,
          {
            provide: DynamicToolRegistryService,
            useValue: mockDynamicRegistry2,
          },
          {
            provide: DynamicToolExecutorService,
            useValue: mockDynamicExecutor2,
          },
          {
            provide: EdgeRelayRegistryService,
            useValue: mockEdgeRelayRegistry,
          },
        ],
      }).compile();
      const dynamicService = module2.get<McpClientService>(McpClientService);

      // The executor mock is what's called for dynamic providers — we verify
      // that the static scrubToolResult() path is NOT inserted between the
      // executor result and the caller (executor owns its own PII scrubbing).
      const result = await dynamicService.callTool({
        provider: 'some_dynamic_provider',
        name: 'some_tool',
        args: {},
        ownerId: 'user-1',
      });

      // Result comes straight from dynamicExecutor.execute() — not double-scrubbed.
      expect(mockDynamicExecutor2.execute).toHaveBeenCalled();
      expect(result?.content?.[0]).toMatchObject({ text: 'user@example.com' });
    });
  });

  describe('Bug fix #3 — evictStaleResourceCache (memory leak fix)', () => {
    afterEach(() => jest.useRealTimers());

    it('removes entries whose fetchedAt is older than MCP_RESOURCE_CONTENT_CACHE_TTL_MS', async () => {
      jest.useFakeTimers();
      mockReadResource.mockResolvedValue({
        contents: [{ text: 'old content' }],
      });

      // Populate cache with an entry
      await service.readResource('sql_server', 'file://old-doc', 'user-1');
      // Advance past TTL
      jest.advanceTimersByTime(
        ORCHESTRATION_CONSTANTS.MCP_RESOURCE_CONTENT_CACHE_TTL_MS + 1000,
      );

      service.evictStaleResourceCache();

      // After eviction, the next readResource must go live (cache miss)
      await service.readResource('sql_server', 'file://old-doc', 'user-1');
      expect(mockReadResource).toHaveBeenCalledTimes(2);
    });

    it('keeps entries still within TTL — does not evict fresh cache', async () => {
      jest.useFakeTimers();
      mockReadResource.mockResolvedValue({ contents: [{ text: 'fresh' }] });

      await service.readResource('sql_server', 'file://fresh-doc', 'user-1');
      jest.advanceTimersByTime(1000); // well within TTL

      service.evictStaleResourceCache();

      // Cache still warm — no second read
      await service.readResource('sql_server', 'file://fresh-doc', 'user-1');
      expect(mockReadResource).toHaveBeenCalledTimes(1);
    });

    it('evicts only stale entries, keeping fresh ones, when cache has a mix', async () => {
      jest.useFakeTimers();
      mockReadResource.mockResolvedValue({ contents: [{ text: 'content' }] });

      // Populate 2 entries — one for each URI
      await service.readResource('sql_server', 'file://stale', 'user-1');
      jest.advanceTimersByTime(
        ORCHESTRATION_CONSTANTS.MCP_RESOURCE_CONTENT_CACHE_TTL_MS + 1000,
      );
      await service.readResource('sql_server', 'file://fresh', 'user-1');

      // At this point: 'stale' is beyond TTL, 'fresh' is just created
      service.evictStaleResourceCache();

      // 'stale' should require a live read; 'fresh' should hit cache
      await service.readResource('sql_server', 'file://stale', 'user-1');
      await service.readResource('sql_server', 'file://fresh', 'user-1');

      // readResource calls: 1 (stale) + 1 (fresh) + 1 (stale re-read after eviction) = 3
      // (fresh re-read hits cache, not counted)
      expect(mockReadResource).toHaveBeenCalledTimes(3);
    });

    it('is a no-op when the cache is empty', () => {
      expect(() => service.evictStaleResourceCache()).not.toThrow();
    });

    it('bounds memory: each eviction cycle removes entries for URIs no longer actively used', async () => {
      jest.useFakeTimers();
      mockReadResource.mockResolvedValue({ contents: [{ text: 'x' }] });

      // Simulate many different URIs being read
      for (let i = 0; i < 10; i++) {
        await service.readResource('sql_server', `file://doc-${i}`, 'user-1');
      }
      const cacheSize = () =>
        (service as any).resourceContentCache.size as number;
      expect(cacheSize()).toBe(10);

      jest.advanceTimersByTime(
        ORCHESTRATION_CONSTANTS.MCP_RESOURCE_CONTENT_CACHE_TTL_MS + 1000,
      );
      service.evictStaleResourceCache();

      expect(cacheSize()).toBe(0);
    });
  });

  describe('Edge MCP Server plan, Phase 1 — per-workspace isolation for perWorkspaceInstance providers', () => {
    it('routes callTool() through a SEPARATE breaker key per workspace for a perWorkspaceInstance provider — 1 workspace lỗi không ảnh hưởng workspace khác', async () => {
      mockCallTool.mockResolvedValue({ content: [] });
      // readOnlyHint để không bị chặn bởi gate fail-closed (không phải trọng
      // tâm test này — xem describe "callTool() fail-closed write gate...").
      const readOnlyXTool = {
        data: [
          {
            name: 'x',
            description: '',
            inputSchema: {},
            annotations: { readOnlyHint: true },
          },
        ],
        fetchedAt: Date.now(),
      };
      (service as any).toolsCache.set(
        'edge_relay_test:workspace-A',
        readOnlyXTool,
      );
      (service as any).toolsCache.set(
        'edge_relay_test:workspace-B',
        readOnlyXTool,
      );

      await service.callTool({
        provider: 'edge_relay_test',
        name: 'x',
        args: {},
        ownerId: 'user-1',
        workspaceId: 'workspace-A',
      });
      await service.callTool({
        provider: 'edge_relay_test',
        name: 'x',
        args: {},
        ownerId: 'user-1',
        workspaceId: 'workspace-B',
      });

      expect(mockCircuitBreaker.run).toHaveBeenCalledWith(
        'mcp:edge_relay_test:workspace-A',
        expect.any(Function),
        undefined,
      );
      expect(mockCircuitBreaker.run).toHaveBeenCalledWith(
        'mcp:edge_relay_test:workspace-B',
        expect.any(Function),
        undefined,
      );
    });

    it('does NOT share the tool-list cache across 2 workspaces for a perWorkspaceInstance provider — bug thật đã tự phát hiện (đọc code), tránh lộ tool GHI của workspace khác qua cache', async () => {
      mockListTools
        .mockResolvedValueOnce({
          tools: [{ name: 'read_only_tool', description: '', inputSchema: {} }],
        })
        .mockResolvedValueOnce({
          tools: [
            { name: 'read_only_tool', description: '', inputSchema: {} },
            {
              name: 'write_tool',
              description: '',
              inputSchema: {},
              annotations: { destructiveHint: true },
            },
          ],
        });

      const toolsA = await service.getTools(
        'edge_relay_test',
        undefined,
        undefined,
        'workspace-A',
      );
      const toolsB = await service.getTools(
        'edge_relay_test',
        undefined,
        undefined,
        'workspace-B',
      );

      expect(toolsA).toEqual([
        { name: 'read_only_tool', description: '', inputSchema: {} },
      ]);
      expect(toolsB).toHaveLength(2);
      // 2 lần gọi listTools() THẬT — không phải workspace-B ăn cache của A.
      expect(mockListTools).toHaveBeenCalledTimes(2);
    });

    it('still shares ONE breaker key/cache across "workspaceId" values for a provider WITHOUT perWorkspaceInstance (sql_server) — không làm loãng ngưỡng circuit breaker vô cớ', async () => {
      mockListTools.mockResolvedValue({ tools: [] });
      mockCallTool.mockResolvedValue({ content: [] });

      await service.callTool({
        provider: 'sql_server',
        name: 'x',
        args: {},
        ownerId: 'user-1',
        workspaceId: 'workspace-A',
      });
      await service.callTool({
        provider: 'sql_server',
        name: 'x',
        args: {},
        ownerId: 'user-1',
        workspaceId: 'workspace-B',
      });

      // Cả 2 lần đều đi qua ĐÚNG 1 key chung — provider dùng chung 1 instance
      // cho mọi workspace, tách key theo workspace chỉ làm loãng ngưỡng
      // circuit breaker vô ích (xem route-key.util.ts).
      expect(mockCircuitBreaker.run).toHaveBeenCalledWith(
        'mcp:sql_server',
        expect.any(Function),
        undefined,
      );
      expect(mockCircuitBreaker.run).not.toHaveBeenCalledWith(
        'mcp:sql_server:workspace-A',
        expect.any(Function),
        undefined,
      );
    });
  });

  describe('Edge MCP Server plan, Phase 2 — relay dispatch and error envelope', () => {
    afterEach(() => jest.useRealTimers());

    // Tool "x" dùng xuyên suốt describe này để test transport/connection —
    // đánh dấu readOnlyHint để không bị chặn bởi gate fail-closed (test riêng
    // ở dưới, "callTool() fail-closed write gate...", đã cover phần đó rồi).
    // Cache cả key có workspaceId lẫn key bare (fallback khi thiếu workspaceId).
    beforeEach(() => {
      const readOnlyXTool = {
        data: [
          {
            name: 'x',
            description: '',
            inputSchema: {},
            annotations: { readOnlyHint: true },
          },
        ],
        fetchedAt: Date.now(),
      };
      (service as any).toolsCache.set(
        'edge_relay_test:workspace-A',
        readOnlyXTool,
      );
      (service as any).toolsCache.set('edge_relay_test', readOnlyXTool);
    });

    it('connects a perWorkspaceInstance provider through RelayClientTransport, not StreamableHTTPClientTransport', async () => {
      mockCallTool.mockResolvedValue({ content: [] });

      await service.callTool({
        provider: 'edge_relay_test',
        name: 'x',
        args: {},
        ownerId: 'user-1',
        workspaceId: 'workspace-A',
      });

      expect(mockConnect).toHaveBeenCalledTimes(1);
      expect(mockConnect.mock.calls[0][0]).toBeInstanceOf(RelayClientTransport);
    });

    it('throws AGENT_NOT_REGISTERED-style RpcException when a perWorkspaceInstance provider is called without a workspaceId', async () => {
      await expect(
        service.callTool({
          provider: 'edge_relay_test',
          name: 'x',
          args: {},
          ownerId: 'user-1',
        }),
      ).rejects.toThrow();
      expect(mockConnect).not.toHaveBeenCalled();
    });

    it('shares ONE connection across 2 different owners in the same workspace for a perWorkspaceInstance provider (regression — separate sessions on 1 relay socket would race JSON-RPC ids)', async () => {
      mockCallTool.mockResolvedValue({ content: [] });

      await service.callTool({
        provider: 'edge_relay_test',
        name: 'x',
        args: {},
        ownerId: 'user-1',
        workspaceId: 'workspace-A',
      });
      await service.callTool({
        provider: 'edge_relay_test',
        name: 'x',
        args: {},
        ownerId: 'user-2',
        workspaceId: 'workspace-A',
      });

      expect(mockConnect).toHaveBeenCalledTimes(1);
    });

    it('still gives 2 different owners SEPARATE connections for a provider WITHOUT perWorkspaceInstance (sql_server) — regression, unchanged behavior', async () => {
      mockCallTool.mockResolvedValue({ content: [] });

      await service.callTool({
        provider: 'sql_server',
        name: 'x',
        args: {},
        ownerId: 'user-1',
        workspaceId: 'workspace-A',
      });
      await service.callTool({
        provider: 'sql_server',
        name: 'x',
        args: {},
        ownerId: 'user-2',
        workspaceId: 'workspace-A',
      });

      expect(mockConnect).toHaveBeenCalledTimes(2);
    });

    it('converts a RelayOfflineError into a retryable:false JSON error envelope instead of throwing', async () => {
      // Tool đọc — RelayOfflineError xảy ra ở bước connect(), không liên quan
      // gì tới gate ghi/đọc (đằng nào 1 tool ghi cũng đã bị chặn TRƯỚC khi kịp
      // connect, xem describe "callTool() fail-closed write gate..." ở dưới).
      mockConnect.mockRejectedValue(new RelayOfflineError('workspace-A'));

      const result = await service.callTool({
        provider: 'edge_relay_test',
        name: 'x',
        args: {},
        ownerId: 'user-1',
        workspaceId: 'workspace-A',
      });

      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content![0].text as string);
      expect(parsed).toEqual({
        error: true,
        retryable: false,
        code: 'RELAY_OFFLINE',
        message: expect.stringContaining('workspace-A'),
      });
    });

    it('converts a RelayTimeoutError into a retryable:true envelope for a read-only tool (safe to retry)', async () => {
      jest.useFakeTimers();
      (service as any).toolsCache.set('edge_relay_test:workspace-A', {
        data: [
          {
            name: 'read_only_tool',
            description: '',
            inputSchema: {},
            annotations: { readOnlyHint: true },
          },
        ],
        fetchedAt: Date.now(),
      });
      mockConnect.mockRejectedValue(new RelayTimeoutError('workspace-A'));

      const resultPromise = service.callTool({
        provider: 'edge_relay_test',
        name: 'read_only_tool',
        args: {},
        ownerId: 'user-1',
        workspaceId: 'workspace-A',
      });
      await jest.runAllTimersAsync();
      const result = await resultPromise;

      const parsed = JSON.parse(result.content![0].text as string);
      expect(parsed).toMatchObject({ code: 'RELAY_TIMEOUT', retryable: true });
    });
  });

  describe('callTool() fail-closed write gate for perWorkspaceInstance providers (lớp chặn thứ 2, độc lập với quyền db_datareader phía SQL Server)', () => {
    it('blocks a tool WITHOUT readOnlyHint before ever attempting the network call', async () => {
      (service as any).toolsCache.set('edge_relay_test:workspace-A', {
        data: [
          {
            name: 'write_tool',
            description: '',
            inputSchema: {},
            annotations: { readOnlyHint: false, destructiveHint: true },
          },
        ],
        fetchedAt: Date.now(),
      });

      const result = await service.callTool({
        provider: 'edge_relay_test',
        name: 'write_tool',
        args: {},
        ownerId: 'user-1',
        workspaceId: 'workspace-A',
      });

      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content![0].text as string);
      expect(parsed).toMatchObject({
        code: 'RELAY_WRITE_BLOCKED',
        retryable: false,
      });
      expect(mockConnect).not.toHaveBeenCalled();
      expect(mockCallTool).not.toHaveBeenCalled();
    });

    it('fails closed (blocks) when the tool is not in cache at all — cache miss is NOT treated as safe', async () => {
      const result = await service.callTool({
        provider: 'edge_relay_test',
        name: 'unknown_tool',
        args: {},
        ownerId: 'user-1',
        workspaceId: 'workspace-A',
      });

      const parsed = JSON.parse(result.content![0].text as string);
      expect(parsed).toMatchObject({ code: 'RELAY_WRITE_BLOCKED' });
      expect(mockConnect).not.toHaveBeenCalled();
    });

    it('allows a tool WITH readOnlyHint through to the real call', async () => {
      (service as any).toolsCache.set('edge_relay_test:workspace-A', {
        data: [
          {
            name: 'read_only_tool',
            description: '',
            inputSchema: {},
            annotations: { readOnlyHint: true },
          },
        ],
        fetchedAt: Date.now(),
      });
      mockConnect.mockResolvedValue(undefined);
      mockCallTool.mockResolvedValue({
        content: [{ type: 'text', text: 'ok' }],
      });

      const result = await service.callTool({
        provider: 'edge_relay_test',
        name: 'read_only_tool',
        args: {},
        ownerId: 'user-1',
        workspaceId: 'workspace-A',
      });

      expect(result.isError).toBeFalsy();
      expect(mockCallTool).toHaveBeenCalledTimes(1);
    });

    it('does NOT gate a destructive tool for a provider WITHOUT perWorkspaceInstance (sql_server) — regression, HITL approval elsewhere still handles it', async () => {
      (service as any).toolsCache.set('sql_server', {
        data: [
          {
            name: 'execute_write_query',
            description: '',
            inputSchema: {},
            annotations: { readOnlyHint: false, destructiveHint: true },
          },
        ],
        fetchedAt: Date.now(),
      });
      mockConnect.mockResolvedValue(undefined);
      mockCallTool.mockResolvedValue({
        content: [{ type: 'text', text: 'ok' }],
      });

      const result = await service.callTool({
        provider: 'sql_server',
        name: 'execute_write_query',
        args: {},
        ownerId: 'user-1',
      });

      expect(result.isError).toBeFalsy();
      expect(mockCallTool).toHaveBeenCalledTimes(1);
    });
  });

  describe('inFlightLists deduplication (Thundering Herd prevention)', () => {
    it('deduplicates concurrent calls to getTools and resolves all of them with the same result from a single connection/fetch', async () => {
      let callCount = 0;
      mockListTools.mockImplementation(async () => {
        callCount++;
        // Simulate some async delay
        await new Promise((resolve) => setTimeout(resolve, 50));
        return {
          tools: [{ name: 'test_tool', description: 'test', inputSchema: {} }],
        };
      });

      // Fire 3 concurrent calls
      const [r1, r2, r3] = await Promise.all([
        service.getTools('sql_server'),
        service.getTools('sql_server'),
        service.getTools('sql_server'),
      ]);

      // All resolved to the same tools list
      expect(r1).toEqual([
        { name: 'test_tool', description: 'test', inputSchema: {} },
      ]);
      expect(r2).toEqual([
        { name: 'test_tool', description: 'test', inputSchema: {} },
      ]);
      expect(r3).toEqual([
        { name: 'test_tool', description: 'test', inputSchema: {} },
      ]);

      // But listTools was only called ONCE!
      expect(callCount).toBe(1);

      // Cleaned up from inFlightLists map
      expect((service as any).inFlightLists.size).toBe(0);

      // Next call goes live again because cache is now set (but if we clear cache, it will trigger listTools)
      (service as any).toolsCache.delete('sql_server');
      await service.getTools('sql_server');
      expect(callCount).toBe(2);
    });
  });
});
