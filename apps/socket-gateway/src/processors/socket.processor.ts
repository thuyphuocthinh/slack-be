import { Processor } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import {
  EQueueName,
  BaseProcessor,
  EJobName,
  IEmitEventJobData,
  IEmitToUsersJobData,
} from '@slack/queue';
import { SocketGateway } from '../gateway/socket.gateway';

@Processor(EQueueName.SOCKET_QUEUE, { concurrency: 20 })
export class SocketProcessor extends BaseProcessor<
  IEmitEventJobData | IEmitToUsersJobData,
  string,
  EJobName
> {
  constructor(private readonly socketGateway: SocketGateway) {
    super();
  }

  async process(
    job: Job<IEmitEventJobData | IEmitToUsersJobData, string, EJobName>,
  ): Promise<string> {
    if (job.name === EJobName.EMIT_EVENT) {
      this.logger.log(`Processing socket job: ${job.name} (ID: ${job.id})`);
      const { event, room, data } = job.data as IEmitEventJobData;

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
    } else if (job.name === EJobName.EMIT_TO_USERS) {
      this.logger.log(`Processing socket job: ${job.name} (ID: ${job.id})`);
      const { event, userIds, data } = job.data as IEmitToUsersJobData;

      if (event && userIds && Array.isArray(userIds)) {
        userIds.forEach((userId: string) => {
          this.socketGateway.server.to(`user_${userId}`).emit(event, data);
        });
        this.logger.debug(`Emitted event [${event}] to ${userIds.length} users`);
      }
      return 'Success';
    }

    this.logger.warn(`Unknown job name: ${job.name}`);
    return 'Ignored';
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
