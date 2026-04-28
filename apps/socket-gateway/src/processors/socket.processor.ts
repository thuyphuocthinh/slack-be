import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { EQueueName } from '@slack/queue';
import { SocketGateway } from '../gateway/socket.gateway';

@Processor(EQueueName.SOCKET_QUEUE)
export class SocketProcessor extends WorkerHost {
  private readonly logger = new Logger(SocketProcessor.name);

  constructor(private readonly socketGateway: SocketGateway) {
    super();
  }

  async process(job: Job<any, any, string>): Promise<any> {
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

    return { success: true };
  }
}
