import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { ORCHESTRATION_MESSAGE_PATTERNS, PROVIDER_DESCRIPTIONS, PROVIDER_LABELS } from '@slack/constants';
import { McpAuthClientService } from './mcp-auth/mcp-auth-client.service';
import { McpClientService } from './mcp/mcp-client.service';
import { AGENT_REGISTRY } from './registry/agents.registry';
import {
  DisconnectProviderRequestDto,
  DisconnectProviderResponseDto,
  GetProvidersRequestDto,
  InitiateConnectProviderRequestDto,
  ProviderSummaryDto,
  SubmitProviderCredentialsRequestDto,
  SubmitProviderCredentialsResponseDto,
} from './dto/orchestration.dto';
import { InitiateConnectResponseDto } from './dto/mcp-auth.dto';

@Controller()
export class OrchestrationController {
  constructor(
    private readonly mcpAuthClient: McpAuthClientService,
    private readonly mcpClient: McpClientService,
  ) {}

  @MessagePattern(ORCHESTRATION_MESSAGE_PATTERNS.GET_PROVIDERS)
  async getProviders(@Payload() dto: GetProvidersRequestDto): Promise<ProviderSummaryDto[]> {
    const statuses = await this.mcpAuthClient.getConnectionStatus(dto.userId);

    return Promise.all(
      statuses.map(async (status) => {
        const provider = status.provider_id;
        let tools: ProviderSummaryDto['tools'] = [];

        if (AGENT_REGISTRY[provider]?.endpoint) {
          try {
            tools = await this.mcpClient.getTools(provider);
          } catch {
            tools = [];
          }
        }

        return {
          provider,
          label: PROVIDER_LABELS[provider] ?? provider,
          description: PROVIDER_DESCRIPTIONS[provider] ?? '',
          isConnected: status.is_connected,
          tools,
        };
      }),
    );
  }

  @MessagePattern(ORCHESTRATION_MESSAGE_PATTERNS.INITIATE_CONNECT)
  async initiateConnect(
    @Payload() dto: InitiateConnectProviderRequestDto,
  ): Promise<InitiateConnectResponseDto> {
    return this.mcpAuthClient.initiateConnect({ ownerId: dto.userId, provider: dto.provider });
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
}
