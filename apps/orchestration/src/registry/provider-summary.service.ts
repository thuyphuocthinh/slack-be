import { Injectable, Logger } from '@nestjs/common';
import { PROVIDER_DESCRIPTIONS, PROVIDER_LABELS } from '@slack/constants';
import { McpAuthClientService } from '../mcp-auth/mcp-auth-client.service';
import { McpClientService } from '../mcp/mcp-client.service';
import { ProviderStatusDto } from '../dto/mcp-auth.dto';
import { ProviderSummaryDto } from '../dto/orchestration.dto';
import { DynamicProviderDbService } from './dynamic-provider-db.service';
import { AGENT_REGISTRY } from './agents.registry';

@Injectable()
export class ProviderSummaryService {
  private readonly logger = new Logger(ProviderSummaryService.name);

  constructor(
    private readonly mcpAuthClient: McpAuthClientService,
    private readonly mcpClient: McpClientService,
    private readonly dynamicProviderDb: DynamicProviderDbService,
  ) {}

  /**
   * Gộp danh sách provider tĩnh (Google, Slack, Notion...) và provider động (Swagger tự đăng ký)
   * thành 1 danh sách summary duy nhất cho FE.
   */
  async getProviders(userId: string): Promise<ProviderSummaryDto[]> {
    const statuses = await this.mcpAuthClient.getConnectionStatus(userId);

    const [staticProviders, dynamicProviders] = await Promise.all([
      this.buildStaticProviderSummaries(statuses),
      this.buildDynamicProviderSummaries(userId),
    ]);

    return [...staticProviders, ...dynamicProviders];
  }

  private async buildStaticProviderSummaries(
    statuses: ProviderStatusDto[],
  ): Promise<ProviderSummaryDto[]> {
    return Promise.all(
      statuses.map(async (status) => {
        const provider = status.provider_id;
        let tools: ProviderSummaryDto['tools'] = [];
        let resources: ProviderSummaryDto['resources'] = [];
        let prompts: ProviderSummaryDto['prompts'] = [];

        if (AGENT_REGISTRY[provider]?.endpoint) {
          try {
            [tools, resources, prompts] = await Promise.all([
              this.mcpClient.getTools(provider),
              this.mcpClient.getResources(provider),
              this.mcpClient.getPrompts(provider),
            ]);
          } catch (error: any) {
            this.logger.warn(
              `Failed to load MCP tools/resources/prompts for static provider "${provider}": ${error.message}`,
            );
            tools = [];
            resources = [];
            prompts = [];
          }
        }

        return {
          provider,
          label: PROVIDER_LABELS[provider] ?? provider,
          description: PROVIDER_DESCRIPTIONS[provider] ?? '',
          isConnected: status.is_connected,
          tools,
          resources,
          prompts,
          isDynamic: false,
        };
      }),
    );
  }

  private async buildDynamicProviderSummaries(
    userId: string,
  ): Promise<ProviderSummaryDto[]> {
    const dynamicEntities =
      await this.dynamicProviderDb.getProvidersByUser(userId);

    return Promise.all(
      dynamicEntities.map(async (entity) => {
        let tools: ProviderSummaryDto['tools'] = [];
        try {
          tools = await this.mcpClient.getTools(entity.id);
        } catch (error: any) {
          this.logger.warn(
            `Failed to load MCP tools for dynamic provider "${entity.id}": ${error.message}`,
          );
          tools = [];
        }

        return {
          provider: entity.id,
          label: entity.name,
          description:
            entity.description || `Custom Swagger API: ${entity.specUrl}`,
          isConnected: true, // Dynamic provider luôn connected sau khi register
          hasAuth: entity.hasAuth,
          isDynamic: true,
          tools,
          resources: [],
          prompts: [],
        };
      }),
    );
  }
}
