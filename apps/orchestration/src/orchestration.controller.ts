import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { ORCHESTRATION_MESSAGE_PATTERNS } from '@slack/constants';
import { McpAuthClientService } from './mcp-auth/mcp-auth-client.service';
import { McpClientService } from './mcp/mcp-client.service';
import { AiOrchestrationProcessor } from './processor/ai-orchestration.processor';
import { ApprovalRequestService } from './processor/approval-request.service';
import { HealthCheckService } from './common/health-check.service';
import {
  CancelTurnRequestDto,
  CancelTurnResponseDto,
  DisconnectProviderRequestDto,
  DisconnectProviderResponseDto,
  GetMetricsResponseDto,
  GetProvidersRequestDto,
  HealthCheckResponseDto,
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
  UpdateDynamicProviderRequestDto,
  UpdateDynamicProviderResponseDto,
  DeleteDynamicProviderRequestDto,
  DeleteDynamicProviderResponseDto,
} from './dto/orchestration.dto';
import { InitiateConnectResponseDto } from './dto/mcp-auth.dto';
import { DynamicProviderDbService } from './registry/dynamic-provider-db.service';
import { ProviderSummaryService } from './registry/provider-summary.service';

@Controller()
export class OrchestrationController {
  constructor(
    private readonly mcpAuthClient: McpAuthClientService,
    private readonly mcpClient: McpClientService,
    private readonly aiOrchestrationProcessor: AiOrchestrationProcessor,
    private readonly approvalRequest: ApprovalRequestService,
    private readonly dynamicProviderDb: DynamicProviderDbService,
    private readonly providerSummary: ProviderSummaryService,
    private readonly healthCheckService: HealthCheckService,
  ) {}

  @MessagePattern(ORCHESTRATION_MESSAGE_PATTERNS.GET_PROVIDERS)
  async getProviders(
    @Payload() dto: GetProvidersRequestDto,
  ): Promise<ProviderSummaryDto[]> {
    return this.providerSummary.getProviders(dto.userId);
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
    await this.approvalRequest.resolveApproval(dto);
    return { success: true };
  }

  @MessagePattern(ORCHESTRATION_MESSAGE_PATTERNS.CANCEL_TURN)
  async cancelTurn(
    @Payload() dto: CancelTurnRequestDto,
  ): Promise<CancelTurnResponseDto> {
    await this.aiOrchestrationProcessor.cancelTurn(dto);
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
    const entity = await this.dynamicProviderDb.registerProvider(dto);
    return { id: entity.id, success: true };
  }

  @MessagePattern(ORCHESTRATION_MESSAGE_PATTERNS.UPDATE_DYNAMIC_PROVIDER)
  async updateDynamicProvider(
    @Payload() dto: UpdateDynamicProviderRequestDto,
  ): Promise<UpdateDynamicProviderResponseDto> {
    const entity = await this.dynamicProviderDb.updateProvider(dto);
    return { id: entity.id, success: true };
  }

  @MessagePattern(ORCHESTRATION_MESSAGE_PATTERNS.DELETE_DYNAMIC_PROVIDER)
  async deleteDynamicProvider(
    @Payload() dto: DeleteDynamicProviderRequestDto,
  ): Promise<DeleteDynamicProviderResponseDto> {
    await this.dynamicProviderDb.deleteProvider(dto.providerId, dto.userId);
    return { success: true };
  }

  @MessagePattern(ORCHESTRATION_MESSAGE_PATTERNS.HEALTH_CHECK)
  async healthCheck(): Promise<HealthCheckResponseDto> {
    return this.healthCheckService.check();
  }

  @MessagePattern(ORCHESTRATION_MESSAGE_PATTERNS.GET_METRICS)
  async getMetrics(): Promise<GetMetricsResponseDto> {
    return { metricsText: await this.healthCheckService.getMetricsText() };
  }
}
