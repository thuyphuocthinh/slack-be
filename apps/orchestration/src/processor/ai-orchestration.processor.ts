import { Processor } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { traceable } from 'langsmith/traceable';
import {
  BaseProcessor,
  EJobName,
  EQueueName,
  IProcessAiTriggerJobData,
} from '@slack/queue';
import { ORCHESTRATION_CONSTANTS } from '@slack/constants';
import { MessageClientService } from '../message-client.service';
import { ReactLoopService } from '../llm/react-loop.service';
import { SupervisorService } from '../llm/supervisor.service';
import { AvailableAgentDto, DelegationDto, SupervisorRoundDto } from '../dto/supervisor.dto';
import { ToolCallTraceDto } from '../dto/react-loop.dto';
import { ChatHistoryTurnDto } from '../dto/message-client.dto';
import { AgentStreamService } from '../socket/agent-stream.service';
import { describeExternalServiceError } from '../llm/external-service-error.util';

interface AnswerResult {
  content: string;
  toolCalls?: ToolCallTraceDto[];
}

interface DelegateRoundResult {
  round: SupervisorRoundDto;
  toolCalls: ToolCallTraceDto[];
}

@Processor(EQueueName.AI_ORCHESTRATION_QUEUE, { concurrency: 5 })
export class AiOrchestrationProcessor extends BaseProcessor<
  IProcessAiTriggerJobData,
  void,
  EJobName
> {
  constructor(
    private readonly messageClient: MessageClientService,
    private readonly reactLoop: ReactLoopService,
    private readonly supervisor: SupervisorService,
    private readonly agentStream: AgentStreamService,
  ) {
    super();
  }

  async process(
    job: Job<IProcessAiTriggerJobData, void, EJobName>,
  ): Promise<void> {
    switch (job.name) {
      case EJobName.PROCESS_AI_TRIGGER: {
        await this.handleAiTrigger(job.data);
        break;
      }
      default:
        this.logger.warn(`Unknown job name: ${job.name}`);
        throw new Error(`Job name ${job.name} is not supported`);
    }
  }

  private async handleAiTrigger(data: IProcessAiTriggerJobData): Promise<void> {
    const { userId, channelId, workspaceId, messageId, botUserId, channelType } = data;

    const reply = await this.messageClient.createMessage({
      channelId,
      senderId: botUserId,
      content: '🤖 Đang xử lý...',
    });

    // 1 root trace = 1 turn hội thoại, bao trùm CẢ vòng lặp Supervisor↔SubAgent
    // (Step 3) — traceable() lồng theo AsyncLocalStorage nên mọi span con
    // (mỗi lượt Supervisor.decide, mỗi ReactLoop) tự nest đúng cây dù chạy
    // qua nhiều vòng, không cần truyền context tay.
    const traced = traceable((d: IProcessAiTriggerJobData, replyId: string) => this.resolveAnswer(d, replyId), {
      name: 'ai-orchestration-turn',
      metadata: { userId, channelId, workspaceId, messageId: reply.id, triggerMessageId: messageId },
    });

    try {
      const result = await traced(data, reply.id);
      await this.messageClient.updateMessage({ id: reply.id, userId: botUserId, ...result });
    } catch (error) {
      this.logger.error(`AI orchestration failed for message ${messageId}: ${error.message}`, error.stack);
      await this.messageClient.updateMessage({ id: reply.id, userId: botUserId, content: describeExternalServiceError(error) });
    } finally {
      // Luôn báo "done" dù Supervisor tự trả lời hay có delegate (1 hay nhiều
      // vòng), thành công hay lỗi — FE dựa vào tín hiệu này để tắt icon
      // "đang chạy tool...".
      await this.agentStream.emitStep({ userId, channelId, messageId: reply.id, channelType }, { type: 'done' });
    }
  }

  /**
   * Giai đoạn 2, Step 3+8: Supervisor có thể delegate NHIỀU vòng trong cùng 1
   * turn, mỗi vòng có thể gồm NHIỀU agent ĐỘC LẬP chạy song song (fan-out) —
   * sau mỗi vòng, kết quả được đưa lại cho Supervisor để nó quyết định tiếp:
   * đủ tổng hợp trả lời chưa, hay cần delegate thêm. Giới hạn
   * `MAX_SUPERVISOR_ROUNDS` chặn ping-pong vô hạn nếu Supervisor không hội tụ
   * — hết vòng mà chưa hội tụ thì bắt buộc tổng hợp lại (Step 9), không trả
   * thẳng kết quả thô của vòng cuối.
   */
  private async resolveAnswer(data: IProcessAiTriggerJobData, replyMessageId: string): Promise<AnswerResult> {
    const { userId, channelId, messageId } = data;
    const [prompt, agents, history] = await Promise.all([
      this.messageClient.getMessageText({ id: messageId, userId }),
      this.supervisor.getAvailableAgents(userId),
      this.messageClient.getRecentHistory({
        channelId,
        userId,
        beforeMessageId: messageId,
        limit: ORCHESTRATION_CONSTANTS.CHAT_HISTORY_LIMIT,
      }),
    ]);

    const rounds: SupervisorRoundDto[] = [];
    const toolCalls: ToolCallTraceDto[] = [];

    for (let round = 0; round < ORCHESTRATION_CONSTANTS.MAX_SUPERVISOR_ROUNDS; round++) {
      const decision = await this.supervisor.decide(prompt, agents, rounds, history);

      if (decision.action === 'respond') {
        return this.buildAnswer(decision.answer || 'Xin lỗi, mình chưa có câu trả lời phù hợp.', toolCalls);
      }

      const delegations = this.dedupeByAgent(decision.delegations ?? []);
      // Rỗng hoặc TOÀN BỘ agent đều không hợp lệ — bail sớm, khỏi tốn ReactLoop
      // call nào (delegations.every() trên mảng rỗng tự nhiên trả về true).
      if (delegations.every((d) => !agents.some((a) => a.provider === d.agent))) {
        return this.buildAnswer(
          decision.answer ||
          'Mình chưa thể xử lý yêu cầu này với các kết nối hiện có. Vào Settings để kết nối agent phù hợp nhé.',
          toolCalls,
        );
      }

      // delegateRound() không bao giờ throw (tự bắt lỗi ReactLoop bên trong) —
      // Promise.all ở đây an toàn, 1 delegation lỗi không làm mất kết quả của
      // các delegation ANH EM khác đã chạy song song thành công (Step 8).
      const results = await Promise.all(
        delegations.map((d) => this.delegateRound(d, agents, data, prompt, replyMessageId, history)),
      );
      results.forEach((result, i) => {
        if (result) {
          rounds.push(result.round);
          toolCalls.push(...result.toolCalls);
        } else {
          // agent không có trong danh sách khả dụng — ghi nhận rõ để Supervisor
          // vòng sau biết đã bỏ qua phần này, tránh tưởng nhầm là đã xong.
          rounds.push({
            agent: delegations[i].agent,
            task: delegations[i].task,
            result: 'Agent này chưa khả dụng (chưa kết nối hoặc chưa có hạ tầng) — bỏ qua, không thực hiện được phần việc này.',
          });
        }
      });
    }

    this.logger.warn(`Supervisor chưa hội tụ sau ${ORCHESTRATION_CONSTANTS.MAX_SUPERVISOR_ROUNDS} vòng cho user ${userId}, tổng hợp lại kết quả đã có`);
    const finalAnswer = await this.supervisor.synthesize(prompt, rounds);
    return this.buildAnswer(finalAnswer, toolCalls);
  }

  /** Chặn 1 pathological case: Supervisor trả trùng agent trong CÙNG 1 vòng — giữ phần tử đầu tiên. */
  private dedupeByAgent(delegations: DelegationDto[]): DelegationDto[] {
    const seen = new Set<string>();
    return delegations.filter((d) => {
      if (seen.has(d.agent)) return false;
      seen.add(d.agent);
      return true;
    });
  }

  private buildAnswer(content: string, toolCalls: ToolCallTraceDto[]): AnswerResult {
    return { content, toolCalls: toolCalls.length > 0 ? toolCalls : undefined };
  }

  /**
   * Chạy đúng 1 delegation: chốt lại agent Supervisor chọn có thật sự nằm
   * trong danh sách đã đưa cho nó không (schema chỉ ép đúng DẠNG JSON, không
   * ép được model không bịa 1 provider ngoài danh sách), rồi chạy ReAct loop
   * thật trên đúng agent đó. Trả `null` nếu agent không hợp lệ — gọi nơi biết
   * rõ nội dung fallback cần hiển thị.
   *
   * KHÔNG BAO GIỜ throw — 1 ReactLoop lỗi (VD MCP server sập) được bắt và trả
   * về như 1 round có kết quả lỗi, thay vì ném lên làm Promise.all() ở
   * resolveAnswer() reject cả loạt, mất luôn kết quả của delegation ANH EM
   * đã chạy song song thành công (Step 8) — kể cả khi ReactLoop đó đã thực
   * hiện side effect thật (VD tạo GitHub issue) trước khi phần khác lỗi.
   */
  private async delegateRound(
    delegation: DelegationDto,
    agents: AvailableAgentDto[],
    data: IProcessAiTriggerJobData,
    originalPrompt: string,
    replyMessageId: string,
    history: ChatHistoryTurnDto[],
  ): Promise<DelegateRoundResult | null> {
    const { userId, channelId, workspaceId, channelType } = data;
    const targetAgent = agents.find((a) => a.provider === delegation.agent);

    if (!targetAgent) {
      this.logger.warn(`Supervisor delegated to unknown/unavailable agent "${delegation.agent}" for user ${userId}`);
      return null;
    }

    const task = delegation.task || originalPrompt;
    try {
      const { answer, toolCalls } = await this.reactLoop.run({
        prompt: task,
        provider: targetAgent.provider,
        userId,
        channelId,
        workspaceId,
        messageId: replyMessageId,
        channelType,
        history,
      });
      return { round: { agent: targetAgent.provider, task, result: answer }, toolCalls };
    } catch (error) {
      this.logger.error(`ReactLoop failed for agent "${targetAgent.provider}": ${(error as Error).message}`, (error as Error).stack);
      return { round: { agent: targetAgent.provider, task, result: describeExternalServiceError(error) }, toolCalls: [] };
    }
  }
}
