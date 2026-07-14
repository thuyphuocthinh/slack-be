import { Injectable } from '@nestjs/common';
import { ESocketEvent } from '@slack/constants';
import { EJobName, EQueueName, QueueService } from '@slack/queue';

// Nhiều ReactLoopService.run() có thể chạy SONG SONG cùng 1 messageId (Supervisor
// fan-out nhiều agent trong 1 round — xem AiOrchestrationProcessor.delegateRound()).
// Mọi chỗ KHÔNG có rủi ro đó (Supervisor tự synthesize(), approveCheckpoint...)
// dùng chung khoá này — chỉ delegateRound() mới cần sinh khoá riêng theo từng agent.
export const DEFAULT_STREAM_KEY = 'main';

export interface AgentStreamContext {
  userId: string;
  channelId: string;
  // messageId của message BOT (reply) — FE update đúng bubble đang stream.
  messageId: string;
  channelType: string; // 'direct' | 'group'
  // Khoá riêng cho luồng text/resync — xem DEFAULT_STREAM_KEY. Nhiều instance
  // ghi cùng messageId nhưng khác streamKey sẽ không đụng vào text của nhau ở FE.
  streamKey?: string;
}

export interface AgentStreamStep {
  // 'resync' — FE phải THAY THẾ toàn bộ text đang tích luỹ bằng `text` (không
  // nối thêm như 'token') — dùng khi 1 đoạn text đã stream ra hoá ra KHÔNG
  // phải câu trả lời cuối (preamble của vòng có tool-call, hoặc self-check bị
  // revert) — xem ReactLoopService.executeReactLoop(), nguyên tắc "stream = save".
  type: 'tool_call' | 'tool_result' | 'done' | 'token' | 'resync';
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
  constructor(private readonly queueService: QueueService) { }

  /**
   * Luôn chỉ emit vào room riêng của người trigger (`user_<userId>`) —
   * không broadcast vào room channel/group.
   */
  async emitStep(context: AgentStreamContext, step: AgentStreamStep): Promise<void> {
    await this.queueService.addJob(EQueueName.SOCKET_QUEUE, EJobName.EMIT_EVENT, {
      event: ESocketEvent.AGENT_STREAM,
      room: `user_${context.userId}`,
      data: {
        ...step,
        channelId: context.channelId,
        messageId: context.messageId,
        streamKey: context.streamKey ?? DEFAULT_STREAM_KEY,
      },
    });
  }
}
