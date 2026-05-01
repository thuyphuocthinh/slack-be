import { Processor } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import {
  EQueueName,
  BaseProcessor,
  EJobName,
  IEmitEventJobData,
} from '@slack/queue';
import { SocketGateway } from '../gateway/socket.gateway';

@Processor(EQueueName.SOCKET_QUEUE)
export class SocketProcessor extends BaseProcessor<
  IEmitEventJobData,
  string,
  EJobName
> {
  constructor(private readonly socketGateway: SocketGateway) {
    super();
  }

  async process(
    job: Job<IEmitEventJobData, string, EJobName>,
  ): Promise<string> {
    if (job.name !== EJobName.EMIT_EVENT) {
      this.logger.warn(`Unknown job name: ${job.name}`);
      return 'Ignored';
    }
    this.logger.log(`Processing socket job: ${job.name} (ID: ${job.id})`);

    const { event, room, data } = job.data;

    if (event && room) {
      // Emit to specific room (channel)
      this.socketGateway.server.to(room).emit(event, data);
      this.logger.debug(`Emitted event [${event}] to room [${room}]`);
    } else if (event && !room) {
      // Broadcast to all
      this.socketGateway.server.emit(event, data);
      this.logger.debug(`Broadcasted event [${event}] to everyone`);
    }

    return 'Success';
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
