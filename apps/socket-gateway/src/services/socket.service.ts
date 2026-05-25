import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class SocketService {
  private readonly logger = new Logger(SocketService.name);

  // Service này hiện tại trống vì logic Pub/Sub thủ công đã được thay thế
  // bằng RedisIoAdapter và BullMQ.
  // Bạn có thể thêm logic tracking Online/Offline (Presence) vào đây trong tương lai.
}
