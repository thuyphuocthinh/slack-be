import { Injectable, Logger } from '@nestjs/common';
import {
  ORCHESTRATION_CONSTANTS,
  SUPERVISOR_SYSTEM_PROMPT,
  SUPERVISOR_SYNTHESIS_PROMPT,
  SUPERVISOR_DECISION_SCHEMA,
  SUPERVISOR_SYNTHESIS_SCHEMA,
  PROVIDER_DESCRIPTIONS,
} from '@slack/constants';
import { McpAuthClientService } from '../mcp-auth/mcp-auth-client.service';
import { AGENT_REGISTRY } from '../registry/agents.registry';
import { AvailableAgentDto, SupervisorDecisionDto, SupervisorRoundDto } from '../dto/supervisor.dto';
import { ChatHistoryTurnDto } from '../dto/message-client.dto';
import { LlmStrategyFactory } from './strategy/llm-strategy.factory';
import { describeExternalServiceError } from './external-service-error.util';

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
   * đoạn 2, Step 3) — không phải lịch sử chat cũ. `history`: lịch sử hội
   * thoại gần đây trong channel (Step 7 — trước đây chỉ SubAgent nhìn thấy,
   * Supervisor mù hoàn toàn nên dễ route sai với câu hỏi nối ngữ cảnh cũ).
   */
  async decide(
    prompt: string,
    agents: AvailableAgentDto[],
    previousRounds: SupervisorRoundDto[] = [],
    history: ChatHistoryTurnDto[] = [],
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
        prompt: this.buildPrompt(prompt, previousRounds, history),
        schema: SUPERVISOR_DECISION_SCHEMA,
      });
    } catch (error) {
      this.logger.error(`Supervisor decide() failed: ${(error as Error).message}`, (error as Error).stack);
      return { action: 'respond', answer: describeExternalServiceError(error) };
    }
  }

  /**
   * Gọi khi đã hết MAX_SUPERVISOR_ROUNDS mà vẫn chưa "respond" — bắt buộc
   * tổng hợp NGAY những gì đã thu thập được (Step 9), thay vì trả thẳng kết
   * quả thô của vòng cuối (có thể chỉ là 1 phần nhỏ của câu hỏi lớn).
   */
  async synthesize(originalPrompt: string, rounds: SupervisorRoundDto[]): Promise<string> {
    const roundsText = rounds
      .map((r, i) => `${i + 1}. Agent "${r.agent}" (yêu cầu: "${r.task}") → kết quả: ${r.result}`)
      .join('\n');

    try {
      const { strategy, model } = this.llmFactory.resolve(
        process.env.SUPERVISOR_MODEL ?? ORCHESTRATION_CONSTANTS.SUPERVISOR_MODEL,
      );
      const result = await strategy.generateStructured<{ answer: string }>({
        model,
        systemInstruction: SUPERVISOR_SYNTHESIS_PROMPT,
        prompt: `Câu hỏi gốc: ${originalPrompt}\n\nDữ liệu đã thu thập được:\n${roundsText}`,
        schema: SUPERVISOR_SYNTHESIS_SCHEMA,
      });
      return result.answer;
    } catch (error) {
      this.logger.error(`Supervisor synthesize() failed: ${(error as Error).message}`, (error as Error).stack);
      return describeExternalServiceError(error);
    }
  }

  /** Gộp lịch sử hội thoại (nếu có) + prompt gốc + các vòng delegate đã chạy (nếu có) thành 1 prompt duy nhất. */
  private buildPrompt(originalPrompt: string, previousRounds: SupervisorRoundDto[], history: ChatHistoryTurnDto[]): string {
    const sections: string[] = [];

    if (history.length > 0) {
      const historyText = history.map((h) => `${h.role === 'model' ? 'AI' : 'User'}: ${h.text}`).join('\n');
      sections.push(`Lịch sử hội thoại gần đây (chỉ để hiểu ngữ cảnh, KHÔNG phải yêu cầu mới):\n${historyText}`);
    }

    sections.push(`Câu hỏi gốc của user: ${originalPrompt}`);

    if (previousRounds.length > 0) {
      const roundsText = previousRounds
        .map((r, i) => `${i + 1}. Đã delegate agent "${r.agent}" với yêu cầu "${r.task}" → kết quả: ${r.result}`)
        .join('\n');
      sections.push(`Các bước đã thực hiện trong turn này:\n${roundsText}\n\nDựa vào kết quả trên, quyết định tiếp theo.`);
    }

    return sections.join('\n\n');
  }
}
