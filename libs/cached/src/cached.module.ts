// libs/cached/src/cached.module.ts
import { Module, Global, DynamicModule } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { CachedService } from './cached.service';
import { RateLimitService } from './rateLimit.service';
import { AuthCacheService } from './authCached.service';

@Global()
@Module({
  providers: [CachedService, RateLimitService, AuthCacheService],
  exports: [CachedService, RateLimitService, AuthCacheService],
})
export class CachedModule {
  static forRoot(): DynamicModule {
    return {
      module: CachedModule,
      providers: [
        {
          provide: 'REDIS_CLIENT',
          inject: [ConfigService],
          useFactory: (configService: ConfigService) => {
            return new Redis({
              host: configService.get<string>('REDIS_HOST', '127.0.0.1'),
              port: configService.get<number>('REDIS_PORT', 6379),
              password: configService.get<string>('REDIS_PASSWORD'),
              username: configService.get<string>('REDIS_USERNAME'),
            });
          },
        },
      ],
      exports: ['REDIS_CLIENT'],
    };
  }
}

/*
Viewed cached.module.ts:3-27

Cấu hình hiện tại của `CachedModule` đang chạy được, nhưng nó gặp một vài vấn đề về tính "clean" và "mở rộng" so với cái `QueueModule` chúng ta vừa làm:

1.  **Dùng trực tiếp `process.env`:** Cách này khó test và không tận dụng được sức mạnh của `ConfigService` (validation, default values).
2.  **Khởi tạo kết nối cứng:** Kết nối Redis được tạo ngay lập tức khi Module được load, bạn không thể thay đổi config động cho từng App nếu cần.
3.  **Thiếu tính đồng nhất:** Hệ thống của bạn sẽ dễ quản lý hơn nếu mọi Module hạ tầng (Queue, Cache, Database) đều đi theo cùng một pattern `forRoot`.

### Đề xuất Refactor `CachedModule` theo chuẩn:

Bạn nên chuyển sang dùng `forRoot` để đồng bộ với `QueueModule`. Dưới đây là cách mình sửa lại để nó chuyên nghiệp hơn:

```typescript
// libs/cached/src/cached.module.ts
import { Module, Global, DynamicModule } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { CachedService } from './cached.service';
import { RateLimitService } from './rateLimit.service';
import { AuthCacheService } from './authCached.service';

@Global()
@Module({
  providers: [CachedService, RateLimitService, AuthCacheService],
  exports: [CachedService, RateLimitService, AuthCacheService],
})
export class CachedModule {
  static forRoot(): DynamicModule {
    return {
      module: CachedModule,
      providers: [
        {
          provide: 'REDIS_CLIENT',
          inject: [ConfigService],
          useFactory: (configService: ConfigService) => {
            return new Redis({
              host: configService.get<string>('REDIS_HOST', '127.0.0.1'),
              port: configService.get<number>('REDIS_PORT', 6379),
              password: configService.get<string>('REDIS_PASSWORD'),
              username: configService.get<string>('REDIS_USERNAME'),
            });
          },
        },
      ],
      exports: ['REDIS_CLIENT'],
    };
  }
}
```

### Tại sao nên sửa như thế này?
1.  **Consistency (Tính đồng nhất):** Dev vào dự án sẽ thấy: "À, muốn dùng Queue thì `QueueModule.forRoot()`, muốn dùng Cache thì `CachedModule.forRoot()`". Rất dễ học, dễ nhớ.
2.  **Type-Safe & Validation:** Sử dụng `ConfigService` giúp bạn kiểm soát lỗi thiếu biến môi trường ngay từ lúc khởi động app.
3.  **Lazy Connection:** Bạn chỉ kết nối tới Redis khi thực sự gọi `forRoot()`.

**Cách dùng mới:**
Ở các `AppModule` (Auth, Notification, Workspace...), bạn chỉ cần thêm:
```typescript
imports: [
  CachedModule.forRoot(),
  QueueModule.forRoot(),
  // ...
]
```
*/
