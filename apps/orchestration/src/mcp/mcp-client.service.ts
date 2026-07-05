import { Injectable, Logger } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { ORCHESTRATION_CONSTANTS, ORCHESTRATION_ERROR } from '@slack/constants';
import { AGENT_REGISTRY } from '../registry/agents.registry';
import {
  CallToolRequestDto,
  CallToolResponseDto,
  McpToolDto,
} from '../dto/mcp.dto';
import { withTimeout } from '../llm/with-timeout.util';
import { CircuitBreakerService } from '../common/circuit-breaker.service';

interface CachedTools {
  tools: McpToolDto[];
  fetchedAt: number;
}

@Injectable()
export class McpClientService {
  private readonly logger = new Logger(McpClientService.name);
  private readonly clients = new Map<string, Client>();
  private readonly toolsCache = new Map<string, CachedTools>();

  constructor(private readonly circuitBreaker: CircuitBreakerService) {}

  // Header là static per-transport (SDK không hỗ trợ header per-call) — nên
  // cache 1 client riêng cho mỗi (provider, ownerId) khi cần gọi tool thật;
  // client dùng để chỉ listTools() (không cần owner) cache riêng theo provider.
  private async getClient(provider: string, ownerId?: string): Promise<Client> {
    const cacheKey = `${provider}:${ownerId ?? '__anon__'}`;
    const cached = this.clients.get(cacheKey);
    if (cached) return cached;

    const entry = AGENT_REGISTRY[provider];
    if (!entry?.endpoint) {
      throw new RpcException(ORCHESTRATION_ERROR.AGENT_NOT_REGISTERED);
    }

    const headers: Record<string, string> = {
      'X-Internal-Api-Key': process.env.MCP_SERVER_INTERNAL_API_KEY ?? '',
    };
    if (ownerId) headers['X-Owner-Id'] = ownerId;

    const client = new Client({ name: 'orchestration', version: '1.0.0' });
    const transport = new StreamableHTTPClientTransport(
      new URL(entry.endpoint),
      {
        requestInit: { headers },
      },
    );
    await withTimeout(
      client.connect(transport),
      ORCHESTRATION_CONSTANTS.MCP_CALL_TIMEOUT_MS,
      `MCP connect() timeout sau ${ORCHESTRATION_CONSTANTS.MCP_CALL_TIMEOUT_MS / 1000}s (provider=${provider})`,
    );

    this.clients.set(cacheKey, client);
    this.logger.log(
      `Connected MCP client for provider "${provider}" at ${entry.endpoint}`,
    );
    return client;
  }

  async getTools(provider: string): Promise<McpToolDto[]> {
    const cached = this.toolsCache.get(provider);
    if (
      cached &&
      Date.now() - cached.fetchedAt <
        ORCHESTRATION_CONSTANTS.MCP_TOOLS_CACHE_TTL_MS
    ) {
      return cached.tools;
    }

    const tools = await this.withReconnect(
      provider,
      undefined,
      async (client) => {
        const result = await client.listTools();
        return result.tools as McpToolDto[];
      },
    );

    this.toolsCache.set(provider, { tools, fetchedAt: Date.now() });
    return tools;
  }

  async callTool(dto: CallToolRequestDto): Promise<CallToolResponseDto> {
    return this.withReconnect(
      dto.provider,
      dto.ownerId,
      (client) =>
        client.callTool({
          name: dto.name,
          arguments: dto.args,
        }) as Promise<CallToolResponseDto>,
    );
  }

  /**
   * Giai đoạn 4, Step 6 — circuit breaker theo TỪNG PROVIDER (không theo
   * ownerId — 1 MCP server sập là lỗi hạ tầng, không phải lỗi riêng của 1
   * user). Khi mạch OPEN, request mới fail NGAY, không đợi hết
   * MCP_CALL_TIMEOUT_MS/thử reconnect như bình thường.
   */
  private async withReconnect<T>(
    provider: string,
    ownerId: string | undefined,
    fn: (client: Client) => Promise<T>,
  ): Promise<T> {
    return this.circuitBreaker.run(`mcp:${provider}`, () =>
      this.callWithReconnect(provider, ownerId, fn),
    );
  }

  /**
   * Client cache sống lâu hơn 1 lần deploy của mcp_server — nếu mcp_server
   * restart (session trong RAM mất sạch) mà client vẫn cầm session cũ, request
   * sẽ lỗi ("Server not initialized"/"Server already initialized"...). Gặp lỗi
   * là bỏ luôn client cũ, tạo kết nối mới rồi thử lại đúng 1 lần.
   */
  private async callWithReconnect<T>(
    provider: string,
    ownerId: string | undefined,
    fn: (client: Client) => Promise<T>,
  ): Promise<T> {
    const cacheKey = `${provider}:${ownerId ?? '__anon__'}`;
    const timeoutMsg = `MCP call timeout sau ${ORCHESTRATION_CONSTANTS.MCP_CALL_TIMEOUT_MS / 1000}s (${cacheKey})`;
    const client = await this.getClient(provider, ownerId);
    try {
      return await withTimeout(
        fn(client),
        ORCHESTRATION_CONSTANTS.MCP_CALL_TIMEOUT_MS,
        timeoutMsg,
      );
    } catch (error) {
      this.logger.warn(
        `MCP call failed for "${cacheKey}", reconnecting and retrying once: ${error.message}`,
      );
      this.clients.delete(cacheKey);
      const freshClient = await this.getClient(provider, ownerId);
      return withTimeout(
        fn(freshClient),
        ORCHESTRATION_CONSTANTS.MCP_CALL_TIMEOUT_MS,
        timeoutMsg,
      );
    }
  }
}
