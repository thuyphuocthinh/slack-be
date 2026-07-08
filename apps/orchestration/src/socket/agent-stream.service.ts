import { Injectable } from '@nestjs/common';
import { ESocketEvent } from '@slack/constants';
import { EJobName, EQueueName, QueueService } from '@slack/queue';

export interface AgentStreamContext {
  userId: string;
  channelId: string;
  // messageId của message BOT (reply) — FE update đúng bubble đang stream.
  messageId: string;
  channelType: string; // 'direct' | 'group'
}

export interface AgentStreamStep {
  type: 'tool_call' | 'tool_result' | 'done' | 'token';
  tool?: string;
  status?: 'success' | 'error';
  resultPreview?: string;
  text?: string;
}

/**
 * Tách riêng khỏi ReactLoopService — "done" (kết thúc turn) giờ do tầng
 * orchestrator ngoài cùng (AiOrchestrationProcessor) phát ra, bao trùm cả
 * nhánh Supervisor tự trả lời lẫn nhánh delegate; "tool_call"/"tool_result"
 * vẫn do ReactLoopService phát vì chỉ nó biết chi tiết từng bước tool. Gộp
 * logic build room vào 1 chỗ duy nhất — thêm step type mới (Giai đoạn 3
 * HITL sẽ cần) không phải sửa nhiều nơi.
 */
@Injectable()
export class AgentStreamService {
  constructor(private readonly queueService: QueueService) {}

  /**
   * Chi tiết (tool đang chạy, kết quả, done...) → chỉ vào room riêng của
   * người trigger. Signal thô (chỉ type, không kèm tool) → thêm vào room
   * channel, chỉ khi channel là GROUP (DIRECT chỉ có 1 người, không cần).
   */
  async emitStep(context: AgentStreamContext, step: AgentStreamStep): Promise<void> {
    await this.queueService.addJob(EQueueName.SOCKET_QUEUE, EJobName.EMIT_EVENT, {
      event: ESocketEvent.AGENT_STREAM,
      room: `user_${context.userId}`,
      data: { ...step, channelId: context.channelId, messageId: context.messageId },
    });

    if (context.channelType === 'group') {
      await this.queueService.addJob(EQueueName.SOCKET_QUEUE, EJobName.EMIT_EVENT, {
        event: ESocketEvent.AGENT_STREAM,
        room: context.channelId,
        data: { type: step.type, channelId: context.channelId, messageId: context.messageId, ...(step.text !== undefined ? { text: step.text } : {}) },
      });
    }
  }
}
