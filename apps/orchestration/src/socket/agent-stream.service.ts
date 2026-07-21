import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
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

// Log thật (session 2026-07-20): 1 câu trả lời dài (~vài trăm từ) sinh ra HÀNG
// TRĂM job Redis riêng lẻ trong vài giây — mỗi chunk SSE từ provider (thường
// chỉ vài ký tự, xem OpenAiStrategy.sendMessage() `onToken(delta.content)`)
// đẩy thẳng 1 job BullMQ riêng (Redis write + worker pickup + socket emit).
// Không sai logic (không mất dữ liệu, không lặp vô hạn) nhưng KHÔNG chịu được
// tải nhiều turn đồng thời — gộp nhiều token chunk liên tiếp (cùng messageId +
// streamKey) thành 1 job duy nhất, xả theo thời gian, giảm số job hàng chục lần
// mà FE vẫn nhận đúng thứ tự (FE chỉ nối `text` lại, chunk to/nhỏ không đổi kết
// quả cuối). Step KHÔNG PHẢI 'token' (tool_call/tool_result/resync/done) luôn
// xả hết token đang gộp dở TRƯỚC rồi mới emit chính nó — giữ đúng thứ tự event.
const TOKEN_BATCH_FLUSH_MS = 75;

interface PendingTokenBatch {
  text: string;
  context: AgentStreamContext;
  timer: NodeJS.Timeout;
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
export class AgentStreamService implements OnModuleDestroy {
  private readonly logger = new Logger(AgentStreamService.name);
  // Khoá theo `${messageId}:${streamKey}` — cô lập đúng 1 luồng text (xem
  // AgentStreamContext.streamKey), khớp cách FE tách nội dung theo streamKey.
  private readonly pendingTokenBatches = new Map<string, PendingTokenBatch>();

  constructor(private readonly queueService: QueueService) {}

  /**
   * Luôn chỉ emit vào room riêng của người trigger (`user_<userId>`) —
   * không broadcast vào room channel/group.
   */
  async emitStep(
    context: AgentStreamContext,
    step: AgentStreamStep,
  ): Promise<void> {
    const key = this.batchKey(context);

    if (step.type === 'token') {
      this.bufferToken(key, context, step.text ?? '');
      return;
    }

    // Bất kỳ step nào KHÁC 'token' phải thấy đúng phần token đã gộp TRƯỚC nó —
    // xả ngay (đồng bộ với emit thật, không phải chỉ xoá buffer) rồi mới emit.
    await this.flush(key);
    await this.emitNow(context, step);
  }

  async onModuleDestroy(): Promise<void> {
    // Tắt app giữa lúc đang stream — xả nốt phần token còn dở thay vì mất
    // trắng đoạn cuối cùng chưa kịp tới ngưỡng flush.
    await Promise.all(
      [...this.pendingTokenBatches.keys()].map((key) => this.flush(key)),
    );
  }

  private batchKey(context: AgentStreamContext): string {
    return `${context.messageId}:${context.streamKey ?? DEFAULT_STREAM_KEY}`;
  }

  private bufferToken(
    key: string,
    context: AgentStreamContext,
    text: string,
  ): void {
    const existing = this.pendingTokenBatches.get(key);
    if (existing) {
      existing.text += text;
      return;
    }
    const timer = setTimeout(() => {
      this.flush(key).catch((error) =>
        this.logger.error(
          `flush() failed for ${key}: ${(error as Error).message}`,
        ),
      );
    }, TOKEN_BATCH_FLUSH_MS);
    this.pendingTokenBatches.set(key, { text, context, timer });
  }

  private async flush(key: string): Promise<void> {
    const batch = this.pendingTokenBatches.get(key);
    if (!batch) return;
    clearTimeout(batch.timer);
    this.pendingTokenBatches.delete(key);
    await this.emitNow(batch.context, { type: 'token', text: batch.text });
  }

  private async emitNow(
    context: AgentStreamContext,
    step: AgentStreamStep,
  ): Promise<void> {
    await this.queueService.addJob(
      EQueueName.SOCKET_QUEUE,
      EJobName.EMIT_EVENT,
      {
        event: ESocketEvent.AGENT_STREAM,
        room: `user_${context.userId}`,
        data: {
          ...step,
          channelId: context.channelId,
          messageId: context.messageId,
          streamKey: context.streamKey ?? DEFAULT_STREAM_KEY,
        },
      },
    );
  }
}
