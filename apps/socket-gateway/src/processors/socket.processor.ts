import { Processor } from '@nestjs/bullmq';
import { OnModuleDestroy } from '@nestjs/common';
import { Job } from 'bullmq';
import {
  EQueueName,
  BaseProcessor,
  EJobName,
  IEmitEventJobData,
  IEmitToUsersJobData,
} from '@slack/queue';
import { ESocketEvent } from '@slack/constants';
import { SocketGateway } from '../gateway/socket.gateway';

// AgentStreamService (orchestration) đánh số `seq` TĂNG DẦN cho mỗi event của
// CÙNG 1 stream (khoá `messageId:streamKey`) — nhưng concurrency=20 bên dưới
// nghĩa là nhiều job của CÙNG 1 stream có thể được fetch/xử lý gần như đồng
// thời, không đảm bảo emit ra socket ĐÚNG thứ tự job được enqueue (VD job sinh
// SAU nhưng xử lý xong TRƯỚC). Giữ lại 1 bộ đệm nhỏ theo từng stream, chỉ emit
// khi đã tới ĐÚNG số thứ tự kế tiếp, xả tiếp các số liền sau nếu đã có sẵn
// trong bộ đệm — FE không cần biết/đổi gì, luôn nhận đúng thứ tự đã emitStep().
interface StreamOrderEntry {
  event: string;
  room: string;
  data: Record<string, unknown>;
}

interface StreamOrderState {
  nextSeq: number;
  buffer: Map<number, StreamOrderEntry>;
  lastActivity: number;
}

const STREAM_ORDER_SWEEP_INTERVAL_MS = 10 * 1000;
// Job bị BullMQ retry hết 3 lần (backoff luỹ thừa 1s/2s/4s ≈ 7s) coi như KHÔNG
// BAO GIỜ tới nữa — đợi lâu hơn khoảng này rồi vẫn thiếu thì xả nốt buffer
// (best-effort, có thể thiếu 1 đoạn) thay vì giữ stream đứng hình mãi mãi.
const STREAM_ORDER_STALE_MS = 10 * 1000;

@Processor(EQueueName.SOCKET_QUEUE, { concurrency: 20 })
export class SocketProcessor
  extends BaseProcessor<
    IEmitEventJobData | IEmitToUsersJobData,
    string,
    EJobName
  >
  implements OnModuleDestroy
{
  private readonly streamOrder = new Map<string, StreamOrderState>();
  private readonly sweepTimer: NodeJS.Timeout;

  constructor(private readonly socketGateway: SocketGateway) {
    super();
    this.sweepTimer = setInterval(
      () => this.sweepStaleStreams(),
      STREAM_ORDER_SWEEP_INTERVAL_MS,
    );
    this.sweepTimer.unref?.();
  }

  onModuleDestroy(): void {
    clearInterval(this.sweepTimer);
  }

  async process(
    job: Job<IEmitEventJobData | IEmitToUsersJobData, string, EJobName>,
  ): Promise<string> {
    if (job.name === EJobName.EMIT_EVENT) {
      this.logger.log(`Processing socket job: ${job.name} (ID: ${job.id})`);
      const { event, room, data } = job.data as IEmitEventJobData;

      if (event && room) {
        this.emitOrdered(event, room, data);
        this.logger.debug(`Emitted event [${event}] to room [${room}]`);
      } else if (event && !room) {
        // Broadcast to all
        this.socketGateway.server.emit(event, data);
        this.logger.debug(`Broadcasted event [${event}] to everyone`);
      }
      return 'Success';
    } else if (job.name === EJobName.EMIT_TO_USERS) {
      this.logger.log(`Processing socket job: ${job.name} (ID: ${job.id})`);
      const { event, userIds, data } = job.data as IEmitToUsersJobData;

      if (event && userIds && Array.isArray(userIds)) {
        userIds.forEach((userId: string) => {
          this.socketGateway.server.to(`user_${userId}`).emit(event, data);
        });
        this.logger.debug(
          `Emitted event [${event}] to ${userIds.length} users`,
        );
      }
      return 'Success';
    }

    this.logger.warn(`Unknown job name: ${job.name}`);
    return 'Ignored';
  }

  // Chỉ AGENT_STREAM kèm `seq`+`messageId` mới cần giữ thứ tự — mọi event khác
  // (tin nhắn mới, video-call signaling, notification...) emit ngay như cũ,
  // KHÔNG bị ảnh hưởng bởi cơ chế này.
  private emitOrdered(
    event: string,
    room: string | string[],
    data: Record<string, unknown>,
  ): void {
    if (
      event !== ESocketEvent.AGENT_STREAM ||
      typeof room !== 'string' ||
      typeof data?.seq !== 'number' ||
      typeof data?.messageId !== 'string'
    ) {
      this.emitDirect(event, room, data);
      return;
    }

    const key = `${room}:${data.messageId}:${data.streamKey ?? 'main'}`;
    const state =
      this.streamOrder.get(key) ??
      ({
        nextSeq: 1,
        buffer: new Map(),
        lastActivity: Date.now(),
      } as StreamOrderState);
    this.streamOrder.set(key, state);
    state.lastActivity = Date.now();

    const seq = data.seq as number;
    if (seq < state.nextSeq) {
      // Job cũ/trùng (VD BullMQ retry sau lần xử lý trước đó bị coi là fail
      // dù thật ra đã emit xong) — bỏ qua, tránh hiện trùng nội dung ở FE.
      return;
    }

    if (seq > state.nextSeq) {
      // Tới sớm hơn phần đứng trước nó — giữ lại, chưa emit vội.
      state.buffer.set(seq, { event, room, data });
      return;
    }

    // seq === nextSeq — đúng lượt, emit rồi xả tiếp các seq liền sau nếu bộ
    // đệm đã có sẵn (tới trước nhưng phải đợi phần đứng trước).
    this.emitDirect(event, room, data);
    state.nextSeq += 1;
    while (state.buffer.has(state.nextSeq)) {
      const next = state.buffer.get(state.nextSeq)!;
      state.buffer.delete(state.nextSeq);
      this.emitDirect(next.event, next.room, next.data);
      state.nextSeq += 1;
    }

    if (data.type === 'done') {
      this.streamOrder.delete(key);
    }
  }

  private emitDirect(
    event: string,
    room: string | string[],
    data: Record<string, unknown>,
  ): void {
    this.socketGateway.server.to(room).emit(event, data);
  }

  // Job bị mất vĩnh viễn (hết retry) sẽ khiến buffer kẹt mãi chờ đúng 1 seq
  // không bao giờ tới — quá STREAM_ORDER_STALE_MS thì xả nốt phần đã có theo
  // đúng thứ tự seq tăng dần (best-effort, có thể thiếu 1 đoạn text) thay vì
  // giữ stream đứng hình vĩnh viễn, rồi dọn state.
  private sweepStaleStreams(): void {
    const now = Date.now();
    for (const [key, state] of this.streamOrder) {
      if (now - state.lastActivity <= STREAM_ORDER_STALE_MS) continue;

      const pendingSeqs = [...state.buffer.keys()].sort((a, b) => a - b);
      for (const seq of pendingSeqs) {
        const entry = state.buffer.get(seq)!;
        this.emitDirect(entry.event, entry.room, entry.data);
      }
      this.streamOrder.delete(key);
    }
  }
}

/*
MessageService muốn gửi tin nhắn. Nó không biết User đang ở WS Server nào.
Nó đẩy 1 Job vào BullMQ.
Chỉ có DUY NHẤT 1 WS Server (ví dụ WS Server 1) nhặt Job đó lên để xử lý (đây là đặc tính của Queue).
WS Server 1 gọi server.to('room_A').emit(...).
Ngay lập tức, RedisIoAdapter sẽ "loan tin" này sang cho WS Server 2 và WS Server 3.
Kết quả: Tất cả User ở cả 3 Server đều nhận được tin nhắn, và mỗi tin nhắn chỉ được gửi đúng 1 lần (không bị lặp).
*/
