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
import { AvailableAgentDto, SupervisorDecisionDto, SupervisorRoundDto } from '../dto/supervisor.dto';
import { ToolCallTraceDto } from '../dto/react-loop.dto';
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
   * Giai đoạn 2, Step 3: Supervisor có thể delegate NHIỀU vòng trong cùng 1
   * turn — sau mỗi vòng, kết quả được đưa lại cho Supervisor để nó quyết
   * định tiếp: đủ tổng hợp trả lời chưa, hay cần delegate thêm (agent khác
   * hoặc agent cũ với phần còn thiếu). Giới hạn `MAX_SUPERVISOR_ROUNDS` chặn
   * ping-pong vô hạn nếu Supervisor không hội tụ.
   */
  private async resolveAnswer(data: IProcessAiTriggerJobData, replyMessageId: string): Promise<AnswerResult> {
    const { userId, messageId } = data;
    const prompt = await this.messageClient.getMessageText({ id: messageId, userId });
    const agents = await this.supervisor.getAvailableAgents(userId);

    const rounds: SupervisorRoundDto[] = [];
    const toolCalls: ToolCallTraceDto[] = [];

    for (let round = 0; round < ORCHESTRATION_CONSTANTS.MAX_SUPERVISOR_ROUNDS; round++) {
      const decision = await this.supervisor.decide(prompt, agents, rounds);

      if (decision.action === 'respond') {
        return this.buildAnswer(decision.answer || 'Xin lỗi, mình chưa có câu trả lời phù hợp.', toolCalls);
      }

      const delegated = await this.delegateRound(decision, agents, data, prompt, replyMessageId);
      if (!delegated) {
        return this.buildAnswer(
          decision.answer ||
            'Mình chưa thể xử lý yêu cầu này với các kết nối hiện có. Vào Settings để kết nối agent phù hợp nhé.',
          toolCalls,
        );
      }

      rounds.push(delegated.round);
      toolCalls.push(...delegated.toolCalls);
    }

    this.logger.warn(`Supervisor chưa hội tụ sau ${ORCHESTRATION_CONSTANTS.MAX_SUPERVISOR_ROUNDS} vòng cho user ${userId}`);
    return this.buildAnswer(
      rounds.at(-1)?.result ?? 'Xin lỗi, câu hỏi này cần nhiều bước hơn mình hỗ trợ được.',
      toolCalls,
    );
  }

  private buildAnswer(content: string, toolCalls: ToolCallTraceDto[]): AnswerResult {
    return { content, toolCalls: toolCalls.length > 0 ? toolCalls : undefined };
  }

  /**
   * Chạy đúng 1 vòng delegate: chốt lại agent Supervisor chọn có thật sự
   * nằm trong danh sách đã đưa cho nó không (responseSchema chỉ ép đúng
   * DẠNG JSON, không ép được model không bịa 1 provider ngoài danh sách),
   * rồi chạy ReAct loop thật trên đúng agent đó. Trả `null` nếu agent không
   * hợp lệ — gọi nơi biết rõ nội dung fallback cần hiển thị.
   */
  private async delegateRound(
    decision: SupervisorDecisionDto,
    agents: AvailableAgentDto[],
    data: IProcessAiTriggerJobData,
    originalPrompt: string,
    replyMessageId: string,
  ): Promise<DelegateRoundResult | null> {
    const { userId, channelId, workspaceId, messageId, channelType } = data;
    const targetAgent = agents.find((a) => a.provider === decision.agent);

    if (!targetAgent) {
      this.logger.warn(`Supervisor delegated to unknown/unavailable agent "${decision.agent}" for user ${userId}`);
      return null;
    }

    const task = decision.task || originalPrompt;
    const { answer, toolCalls } = await this.reactLoop.run({
      prompt: task,
      provider: targetAgent.provider,
      userId,
      channelId,
      workspaceId,
      // dùng messageId của message BOT vừa tạo (reply.id) — đây là message
      // FE cần cập nhật "đang chạy step..." lên, không phải message gốc user hỏi
      messageId: replyMessageId,
      // messageId gốc — dùng làm cursor lấy lịch sử chat TRƯỚC câu hỏi này
      triggerMessageId: messageId,
      channelType,
    });

    return { round: { agent: targetAgent.provider, task, result: answer }, toolCalls };
  }
}
