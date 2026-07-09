import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import {
  ORCHESTRATION_MESSAGE_PATTERNS,
  PROVIDER_DESCRIPTIONS,
  PROVIDER_LABELS,
} from '@slack/constants';
import { McpAuthClientService } from './mcp-auth/mcp-auth-client.service';
import { McpClientService } from './mcp/mcp-client.service';
import { AGENT_REGISTRY } from './registry/agents.registry';
import { AiOrchestrationProcessor } from './processor/ai-orchestration.processor';
import {
  DisconnectProviderRequestDto,
  DisconnectProviderResponseDto,
  GetProvidersRequestDto,
  InitiateConnectProviderRequestDto,
  ProviderSummaryDto,
  ResolveApprovalRequestDto,
  ResolveApprovalResponseDto,
  SubmitProviderCredentialsRequestDto,
  SubmitProviderCredentialsResponseDto,
  TriggerPromptRequestDto,
  TriggerPromptResponseDto,
  RegisterDynamicProviderRequestDto,
  RegisterDynamicProviderResponseDto,
  DeleteDynamicProviderRequestDto,
  DeleteDynamicProviderResponseDto,
} from './dto/orchestration.dto';
import { InitiateConnectResponseDto } from './dto/mcp-auth.dto';
import { DynamicProviderDbService } from './registry/dynamic-provider-db.service';

@Controller()
export class OrchestrationController {
  constructor(
    private readonly mcpAuthClient: McpAuthClientService,
    private readonly mcpClient: McpClientService,
    private readonly aiOrchestrationProcessor: AiOrchestrationProcessor,
    private readonly dynamicProviderDb: DynamicProviderDbService,
  ) { }

  @MessagePattern(ORCHESTRATION_MESSAGE_PATTERNS.GET_PROVIDERS)
  async getProviders(
    @Payload() dto: GetProvidersRequestDto,
  ): Promise<ProviderSummaryDto[]> {
    const statuses = await this.mcpAuthClient.getConnectionStatus(dto.userId);
    
    // Providers tĩnh
    const staticProviders = await Promise.all(
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
              this.mcpClient.getPrompts(provider)
            ]);
          } catch {
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

    // Providers động (Swagger)
    const dynamicEntities = await this.dynamicProviderDb.getProvidersByUser(dto.userId);
    const dynamicProviders = await Promise.all(
      dynamicEntities.map(async (entity) => {
        let tools: ProviderSummaryDto['tools'] = [];
        try {
          tools = await this.mcpClient.getTools(entity.id);
        } catch {
          tools = [];
        }

        return {
          provider: entity.id,
          label: entity.name,
          description: entity.description || `Custom Swagger API: ${entity.specUrl}`,
          isConnected: true, // Dynamic provider luôn connected sau khi register
          hasAuth: entity.hasAuth,
          isDynamic: true,
          tools,
          resources: [],
          prompts: [],
        };
      })
    );

    return [...staticProviders, ...dynamicProviders];
  }

  @MessagePattern(ORCHESTRATION_MESSAGE_PATTERNS.INITIATE_CONNECT)
  async initiateConnect(
    @Payload() dto: InitiateConnectProviderRequestDto,
  ): Promise<InitiateConnectResponseDto> {
    return this.mcpAuthClient.initiateConnect({
      ownerId: dto.userId,
      provider: dto.provider,
    });
  }

  @MessagePattern(ORCHESTRATION_MESSAGE_PATTERNS.SUBMIT_CREDENTIALS)
  async submitCredentials(
    @Payload() dto: SubmitProviderCredentialsRequestDto,
  ): Promise<SubmitProviderCredentialsResponseDto> {
    await this.mcpAuthClient.submitCredentials({
      ownerId: dto.userId,
      provider: dto.provider,
      credentials: dto.credentials,
    });
    // QUAN TRỌNG: @MessagePattern PHẢI return giá trị (không phải void/undefined) —
    // NestJS TCP transport không emit response packet khi handler resolve về
    // undefined, khiến phía gọi (firstValueFrom) nhận EmptyError "no elements in sequence".
    return { success: true };
  }

  @MessagePattern(ORCHESTRATION_MESSAGE_PATTERNS.DISCONNECT_PROVIDER)
  async disconnectProvider(
    @Payload() dto: DisconnectProviderRequestDto,
  ): Promise<DisconnectProviderResponseDto> {
    await this.mcpAuthClient.disconnectProvider(dto.userId, dto.provider);
    return { success: true };
  }

  @MessagePattern(ORCHESTRATION_MESSAGE_PATTERNS.RESOLVE_APPROVAL)
  async resolveApproval(
    @Payload() dto: ResolveApprovalRequestDto,
  ): Promise<ResolveApprovalResponseDto> {
    await this.aiOrchestrationProcessor.resolveApproval(dto);
    return { success: true };
  }

  @MessagePattern(ORCHESTRATION_MESSAGE_PATTERNS.TRIGGER_PROMPT)
  async triggerPrompt(
    @Payload() dto: TriggerPromptRequestDto,
  ): Promise<TriggerPromptResponseDto> {
    const result = await this.mcpClient.getPrompt(
      dto.provider,
      dto.name,
      dto.args,
      dto.userId,
    );

    // Prompt MCP trả về dạng `messages` (role: user/assistant).
    // Gộp tất cả thành 1 chuỗi text để Frontend tự gọi API gửi tin nhắn.
    const text = (result.messages || [])
      .map((msg) => {
        if (msg.content.type === 'text') {
          return msg.content.text;
        }
        return '';
      })
      .filter(Boolean)
      .join('\n');

    return { text: text || 'Template bị rỗng.' };
  }

  @MessagePattern(ORCHESTRATION_MESSAGE_PATTERNS.REGISTER_DYNAMIC_PROVIDER)
  async registerDynamicProvider(
    @Payload() dto: RegisterDynamicProviderRequestDto,
  ): Promise<RegisterDynamicProviderResponseDto> {
    const entity = await this.dynamicProviderDb.createProvider(
      dto.userId,
      dto.name,
      dto.specUrl,
      dto.apiKey,
      dto.description,
    );
    return { id: entity.id, success: true };
  }

  @MessagePattern(ORCHESTRATION_MESSAGE_PATTERNS.DELETE_DYNAMIC_PROVIDER)
  async deleteDynamicProvider(
    @Payload() dto: DeleteDynamicProviderRequestDto,
  ): Promise<DeleteDynamicProviderResponseDto> {
    await this.dynamicProviderDb.deleteProvider(dto.providerId, dto.userId);
    return { success: true };
  }
}
