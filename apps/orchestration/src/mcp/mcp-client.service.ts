import { Injectable, Logger } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { ORCHESTRATION_CONSTANTS, ORCHESTRATION_ERROR } from '@slack/constants';
import { AGENT_REGISTRY } from '../registry/agents.registry';
import { CallToolRequestDto, CallToolResponseDto, McpToolDto } from '../dto/mcp.dto';

interface CachedTools {
  tools: McpToolDto[];
  fetchedAt: number;
}

@Injectable()
export class McpClientService {
  private readonly logger = new Logger(McpClientService.name);
  private readonly clients = new Map<string, Client>();
  private readonly toolsCache = new Map<string, CachedTools>();

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
    const transport = new StreamableHTTPClientTransport(new URL(entry.endpoint), {
      requestInit: { headers },
    });
    await client.connect(transport);

    this.clients.set(cacheKey, client);
    this.logger.log(`Connected MCP client for provider "${provider}" at ${entry.endpoint}`);
    return client;
  }

  async getTools(provider: string): Promise<McpToolDto[]> {
    const cached = this.toolsCache.get(provider);
    if (cached && Date.now() - cached.fetchedAt < ORCHESTRATION_CONSTANTS.MCP_TOOLS_CACHE_TTL_MS) {
      return cached.tools;
    }

    const client = await this.getClient(provider);
    const result = await client.listTools();
    const tools = result.tools as McpToolDto[];

    this.toolsCache.set(provider, { tools, fetchedAt: Date.now() });
    return tools;
  }

  async callTool(dto: CallToolRequestDto): Promise<CallToolResponseDto> {
    const client = await this.getClient(dto.provider, dto.ownerId);
    return client.callTool({ name: dto.name, arguments: dto.args }) as Promise<CallToolResponseDto>;
  }
}
