import { Injectable, Logger } from '@nestjs/common';
import { ORCHESTRATION_CONSTANTS, SUPERVISOR_SYSTEM_PROMPT, PROVIDER_DESCRIPTIONS } from '@slack/constants';
import { McpAuthClientService } from '../mcp-auth/mcp-auth-client.service';
import { AGENT_REGISTRY } from '../registry/agents.registry';
import { AvailableAgentDto, SupervisorDecisionDto, SupervisorRoundDto } from '../dto/supervisor.dto';
import { LlmStrategyFactory } from './strategy/llm-strategy.factory';
import { describeExternalServiceError } from './external-service-error.util';

// JSON Schema CHUẨN (không phải dialect riêng của Gemini/OpenAI/Anthropic)
// — mỗi LlmStrategy tự convert sang format SDK của mình (xem
// GeminiStrategy.toGeminiSchema, OpenAiStrategy/AnthropicStrategy dùng
// gần như nguyên bản vì đã theo chuẩn JSON Schema).
const DECISION_SCHEMA = {
  type: 'object',
  properties: {
    action: { type: 'string', enum: ['respond', 'delegate'] },
    answer: { type: 'string' },
    agent: { type: 'string' },
    task: { type: 'string' },
  },
  required: ['action'],
};

@Injectable()
export class SupervisorService {
  private readonly logger = new Logger(SupervisorService.name);

  constructor(
    private readonly mcpAuthClient: McpAuthClientService,
    private readonly llmFactory: LlmStrategyFactory,
  ) {}

  /**
   * Agent "khả dụng" cho Supervisor = vừa đã connect (mcp-auth) VỪA có hạ
   * tầng thật đăng ký trong AGENT_REGISTRY — agent chưa deploy (registry
   * rỗng endpoint) không được đưa vào lựa chọn dù user có connect provider đó.
   */
  async getAvailableAgents(userId: string): Promise<AvailableAgentDto[]> {
    const statuses = await this.mcpAuthClient.getConnectionStatus(userId);
    return statuses
      .filter((status) => status.is_connected && AGENT_REGISTRY[status.provider_id]?.endpoint)
      .map((status) => ({
        provider: status.provider_id,
        label: AGENT_REGISTRY[status.provider_id].label,
        description: PROVIDER_DESCRIPTIONS[status.provider_id] ?? '',
      }));
  }

  /**
   * `previousRounds`: các vòng delegate ĐÃ chạy xong trong CÙNG 1 turn (Giai
   * đoạn 2, Step 3) — không phải lịch sử chat cũ. Đưa lại cho Supervisor để
   * nó quyết định: đủ tổng hợp trả lời chưa, hay cần delegate tiếp (agent
   * khác hoặc agent cũ với phần việc còn thiếu).
   */
  async decide(
    prompt: string,
    agents: AvailableAgentDto[],
    previousRounds: SupervisorRoundDto[] = [],
  ): Promise<SupervisorDecisionDto> {
    const agentListText =
      agents.length > 0
        ? agents.map((a) => `- ${a.provider} (${a.label}): ${a.description}`).join('\n')
        : '(Người dùng chưa kết nối agent nào — nếu câu hỏi cần dữ liệu, trả lời "respond" và nhắc user vào Settings để kết nối.)';

    try {
      const { strategy, model } = this.llmFactory.resolve(
        process.env.SUPERVISOR_MODEL ?? ORCHESTRATION_CONSTANTS.SUPERVISOR_MODEL,
      );
      return await strategy.generateStructured<SupervisorDecisionDto>({
        model,
        systemInstruction: `${SUPERVISOR_SYSTEM_PROMPT}\n${agentListText}`,
        prompt: this.buildPrompt(prompt, previousRounds),
        schema: DECISION_SCHEMA,
      });
    } catch (error) {
      this.logger.error(`Supervisor decide() failed: ${(error as Error).message}`, (error as Error).stack);
      return { action: 'respond', answer: describeExternalServiceError(error) };
    }
  }

  /** Vòng đầu tiên gửi thẳng prompt gốc; từ vòng 2 trở đi nối thêm kết quả các vòng trước đó. */
  private buildPrompt(originalPrompt: string, previousRounds: SupervisorRoundDto[]): string {
    if (previousRounds.length === 0) return originalPrompt;

    const roundsText = previousRounds
      .map((r, i) => `${i + 1}. Đã delegate agent "${r.agent}" với yêu cầu "${r.task}" → kết quả: ${r.result}`)
      .join('\n');

    return `Câu hỏi gốc của user: ${originalPrompt}\n\nCác bước đã thực hiện trong turn này:\n${roundsText}\n\nDựa vào kết quả trên, quyết định tiếp theo.`;
  }
}
