import { IoAdapter } from '@nestjs/platform-socket.io';
import { ServerOptions } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { Redis } from 'ioredis';
import { ConfigService } from '@nestjs/config';
import { INestApplicationContext } from '@nestjs/common';

export class RedisIoAdapter extends IoAdapter {
  private adapterConstructor: ReturnType<typeof createAdapter>;

  constructor(
    private readonly app: INestApplicationContext,
    private readonly configService: ConfigService,
  ) {
    super(app);
  }

  async connectToRedis(): Promise<void> {
    const host = this.configService.get<string>('REDIS_HOST', '127.0.0.1');
    const port = this.configService.get<number>('REDIS_PORT', 6379);
    const password = this.configService.get<string>('REDIS_PASSWORD');

    // Cấu hình bằng ioredis
    const pubClient = new Redis({
      host,
      port,
      password,
    });
    const subClient = pubClient.duplicate();

    this.adapterConstructor = createAdapter(pubClient, subClient);
  }

  createIOServer(port: number, options?: ServerOptions): any {
    const server = super.createIOServer(port, options);
    server.adapter(this.adapterConstructor);
    return server;
  }
}

/*

**Redis Io Adapter** là một thành phần cực kỳ quan trọng khi bạn muốn chạy ứng dụng WebSocket ở quy mô thực tế (Production). Chức năng chính của nó là **"Đồng bộ hóa sự kiện giữa nhiều server"**.

Dưới đây là 3 lý do tại sao bạn cần nó:

### 1. Xử lý bài toán đa Server (Horizontal Scaling)
Hãy tưởng tượng bạn có 2 server chạy `socket-gateway`:
*   **User A** đang kết nối tới **Server 1**.
*   **User B** đang kết nối tới **Server 2**.

Nếu không có Redis Adapter, khi User A gửi tin nhắn cho User B, **Server 1 sẽ không thể tìm thấy User B** vì User B không nằm trong bộ nhớ RAM của nó. Kết quả là tin nhắn bị mất.

**=> Giải pháp:** Redis Adapter đóng vai trò như một "trạm trung chuyển". Khi Server 1 muốn gửi tin cho User B, nó sẽ đẩy tin nhắn lên Redis. Server 2 đang lắng nghe Redis sẽ nhận được và đẩy tiếp cho User B.

### 2. Broadcast toàn hệ thống
Khi bạn muốn gửi thông báo cho tất cả người dùng (Ví dụ: "Hệ thống sắp bảo trì"), bạn chỉ cần ra lệnh `server.emit()` ở **bất kỳ server nào**. Redis Adapter sẽ đảm bảo lệnh này được truyền tới tất cả các server khác để mọi client đều nhận được thông báo.

### 3. Quản lý Room (Phòng) tập trung
Trong Slack, mỗi Channel là một Room. Redis Adapter giúp quản lý danh sách các Room này một cách tập trung trên Redis thay vì rời rạc ở từng server. 
*   Nếu User A (Server 1) và User B (Server 2) cùng join vào channel `general`.
*   Khi có tin nhắn mới trong `general`, cả hai sẽ đều nhận được nhờ Redis Adapter kết nối các server lại với nhau.

---

### Tóm tắt bằng hình ảnh:

*   **Không có Redis Adapter:** Các server là các "hòn đảo" cô lập. User ở server này không nói chuyện được với user ở server kia.
*   **Có Redis Adapter:** Redis đóng vai trò là "mạch máu" kết nối các hòn đảo lại thành một lục địa duy nhất.

**Trong dự án của bạn:** Vì bạn đang làm theo hướng Microservices, việc dùng Redis Adapter là bắt buộc nếu bạn muốn sau này có thể chạy nhiều bản sao (replica) của `socket-gateway` để chịu tải.
*/
