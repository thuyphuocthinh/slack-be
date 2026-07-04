import { Test, TestingModule } from '@nestjs/testing';
import { McpClientService } from './mcp-client.service';

const mockConnect = jest.fn();
const mockListTools = jest.fn();
const mockCallTool = jest.fn();

jest.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: jest.fn().mockImplementation(() => ({
    connect: mockConnect,
    listTools: mockListTools,
    callTool: mockCallTool,
  })),
}));

jest.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({
  StreamableHTTPClientTransport: jest.fn(),
}));

jest.mock('../registry/agents.registry', () => ({
  AGENT_REGISTRY: {
    sql_server: { label: 'SQL Server', endpoint: 'http://mcp-server/mcp/sql_server' },
  },
}));

describe('McpClientService', () => {
  let service: McpClientService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockConnect.mockResolvedValue(undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [McpClientService],
    }).compile();

    service = module.get<McpClientService>(McpClientService);
  });

  describe('getTools', () => {
    it('passes through MCP tool annotations (Giai đoạn 3 — Risk Gate cần đọc destructiveHint) untouched', async () => {
      mockListTools.mockResolvedValue({
        tools: [
          { name: 'execute_read_only_query', description: 'desc', inputSchema: {}, annotations: { readOnlyHint: true } },
          { name: 'execute_write_query', description: 'desc', inputSchema: {}, annotations: { readOnlyHint: false, destructiveHint: true } },
        ],
      });

      const tools = await service.getTools('sql_server');

      expect(tools[0].annotations).toEqual({ readOnlyHint: true });
      expect(tools[1].annotations).toEqual({ readOnlyHint: false, destructiveHint: true });
    });

    it('caches the result — a second call within TTL does not call listTools() again', async () => {
      mockListTools.mockResolvedValue({ tools: [{ name: 'tool_a', description: '', inputSchema: {} }] });

      await service.getTools('sql_server');
      await service.getTools('sql_server');

      expect(mockListTools).toHaveBeenCalledTimes(1);
    });
  });

  describe('callTool', () => {
    it('forwards name/args to the MCP client', async () => {
      mockCallTool.mockResolvedValue({ content: [{ type: 'text', text: 'ok' }] });

      await service.callTool({ provider: 'sql_server', name: 'execute_read_only_query', args: { query: 'SELECT 1' }, ownerId: 'user-1' });

      expect(mockCallTool).toHaveBeenCalledWith({ name: 'execute_read_only_query', arguments: { query: 'SELECT 1' } });
    });

    it('reconnects and retries exactly once when the first call fails', async () => {
      mockCallTool.mockRejectedValueOnce(new Error('Server not initialized')).mockResolvedValueOnce({ content: [] });

      const result = await service.callTool({ provider: 'sql_server', name: 'get_database_schema', args: {}, ownerId: 'user-1' });

      expect(result).toEqual({ content: [] });
      expect(mockConnect).toHaveBeenCalledTimes(2);
    });
  });
});
