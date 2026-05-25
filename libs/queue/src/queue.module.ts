import { BullModule } from '@nestjs/bullmq';
import { DynamicModule, Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EQueueName } from './constants/queue.constant';
import { QueueService } from './queue.service';

@Global()
@Module({
  providers: [QueueService],
  exports: [QueueService],
})
export class QueueModule {
  static forRoot(): DynamicModule {
    return {
      module: QueueModule,
      imports: [
        BullModule.forRootAsync({
          inject: [ConfigService],
          useFactory: (configService: ConfigService) => ({
            connection: {
              host: configService.get<string>('BULLMQ_HOST', '127.0.0.1'),
              port: configService.get<number>('BULLMQ_PORT', 6380),
              username: configService.get<string>('BULLMQ_USERNAME'),
              password: configService.get<string>('BULLMQ_PASSWORD'),
            },
          }),
        }),
      ],
      exports: [BullModule],
    };
  }

  static forFeature(queues: EQueueName[]): DynamicModule {
    const bullQueues = BullModule.registerQueue(
      ...queues.map((name) => ({
        name,
        defaultJobOptions: {
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 1000,
          },
          removeOnComplete: true,
          removeOnFail: {
            age: 24 * 3600,
          },
        },
      })),
    );

    return {
      module: QueueModule,
      imports: [bullQueues],
      exports: [bullQueues],
    };
  }
}

/*
Đúng vậy, bản chất là **giống hệt nhau** về mặt nguyên lý kết nối, nhưng có một vài điểm bạn cần lưu ý để quản lý cho tốt:

### 1. Giống nhau về nguyên lý:
Cả **BullMQ** và **Cache (Redis)** đều cần kết nối tới Redis Server.
*   Mỗi Microservice đều phải gọi `forRoot` (hoặc tương đương) cho cả Cache và BullMQ để mở kết nối.
*   Nếu bạn có 10 Microservices dùng cả Cache và Queue, thì mỗi Microservice sẽ có ít nhất 2 luồng kết nối riêng biệt tới Redis.

### 2. Có dùng chung một kết nối được không?
Về mặt kỹ thuật, bạn **CÓ THỂ** dùng chung một kết nối Redis (một client `ioredis`) cho cả Cache và BullMQ để tiết kiệm tài nguyên. Tuy nhiên:
*   **NestJS mặc định tách riêng:** `@nestjs/cache-manager` và `@nestjs/bullmq` thường tự quản lý kết nối riêng của chúng để tránh xung đột cấu hình.
*   **Lời khuyên:** Cứ để chúng tách riêng. BullMQ có những yêu cầu đặc thù về kết nối (như việc lắng nghe sự kiện bằng `blocking commands`) mà Cache thông thường không cần. Tách riêng sẽ giúp hệ thống ổn định hơn.

### 3. Cách tổ chức Clean nhất:
Bạn nên làm giống như cách bạn vừa làm với `QueueModule`:
1.  Tạo `libs/cached` (có vẻ bạn đã có rồi).
2.  Trong `libs/cached`, cũng dùng pattern `forRoot` để lấy config từ `.env`.
3.  Mỗi Microservice nào cần dùng Cache thì import `CachedModule.forRoot()` ở module gốc.

### Tóm lại:
Dù là Queue hay Cache, quy tắc vàng trong Microservices vẫn là: **"Mỗi tiến trình (App) tự quản lý kết nối của chính nó"**. 

Đừng cố gắng chia sẻ một kết nối duy nhất giữa các Microservices khác nhau, vì điều đó sẽ phá vỡ tính độc lập và gây ra lỗi dây chuyền nếu một service gặp sự cố về network.
*/

/* 
Dưới đây là giải thích chi tiết các thông số trong `defaultJobOptions` mà chúng ta đã thiết lập. Đây là các cấu hình "vàng" giúp hệ thống của bạn hoạt động ổn định và tự động dọn dẹp bộ nhớ Redis:

### 1. `attempts: 3`
*   **Ý nghĩa:** Số lần thử lại tối đa nếu Job bị lỗi.
*   **Hoạt động:** Nếu code xử lý Job ném ra một lỗi (Exception), BullMQ sẽ không đánh dấu Job đó thất bại ngay lập tức mà sẽ đưa nó vào hàng chờ để chạy lại. Ở đây chúng ta cho phép thử lại tối đa 3 lần.

### 2. `backoff` (Chiến lược thử lại)
*   **`type: 'exponential'`:** Thử lại theo kiểu **số mũ**. 
    *   Lần 1 lỗi: Chờ 1 giây rồi thử lại.
    *   Lần 2 lỗi: Chờ 2 giây rồi thử lại.
    *   Lần 3 lỗi: Chờ 4 giây... (cứ thế nhân đôi).
    *   *Tại sao dùng cái này?* Để tránh việc hệ thống bị "spam" liên tục khi một dịch vụ bên ngoài (như Mail server) đang bị nghẽn.
*   **`delay: 1000`:** Thời gian chờ cơ sở (tính bằng miliseconds). Ở đây là 1 giây.

### 3. `removeOnComplete: true`
*   **Ý nghĩa:** Tự động xóa Job khỏi Redis sau khi nó **hoàn thành thành công**.
*   **Lợi ích:** Cực kỳ quan trọng để **tiết kiệm bộ nhớ Redis**. Nếu bạn gửi 1 triệu email và không xóa Job sau khi xong, Redis của bạn sẽ đầy rác và bị crash. Khi để `true`, chúng ta chỉ quan tâm đến kết quả, xong rồi thì biến mất cho sạch máy.

### 4. `removeOnFail: { age: 24 * 3600 }`
*   **Ý nghĩa:** Tự động xóa các Job **bị lỗi** sau một khoảng thời gian nhất định.
*   **Thông số:** `age: 24 * 3600` (giây) tương đương với **24 giờ**.
*   **Tại sao không xóa ngay?** Khác với Job thành công, Job bị lỗi chúng ta thường muốn giữ lại một khoảng thời gian (ở đây là 1 ngày) để Admin có thể vào xem log xem tại sao nó lỗi, hoặc để "retry manual" nếu cần. Sau 24 giờ mà không ai xử lý thì nó sẽ tự động bị xóa đi.

---

**Tóm lại:** Bộ cấu hình này giúp hệ thống của bạn:
1.  **Kiên cường:** Tự hồi phục khi gặp lỗi tạm thời.
2.  **Thông minh:** Không spam hệ thống khi gặp sự cố nặng.
3.  **Sạch sẽ:** Tự động dọn dẹp Redis, không bao giờ lo bị đầy dung lượng.
*/
