import {
  CanActivate,
  ExecutionContext,
  Injectable,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RateLimitService } from '@slack/cached';
import { RATE_LIMIT_KEY, RateLimitOptions } from './rate-limit.decorator';
import { SYSTEM_ERRORS } from '@slack/constants';

// fix window - 60 seconds - 1 minute, 300 seconds ~ 5 minutes, 3600 seconds ~ 1 hour
// fix limit - number of requests - 100 requests/minute, 500 requests/5 minutes, 10000 requests/hour
@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly rateLimitService: RateLimitService,
  ) { }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const options = this.reflector.getAllAndOverride<RateLimitOptions>(
      RATE_LIMIT_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!options) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const ip = request.ip || request.headers['x-forwarded-for'] || 'unknown';
    const userId = request.user?.sub;

    // Tạo key dựa trên path và định danh (userId hoặc IP)
    const path = request.route?.path || request.url;
    const identifier = userId ? `user:${userId}` : `ip:${ip}`;
    const key = `ratelimit:${path}:${identifier}`;

    const isAllowed = await this.rateLimitService.isAllowed(
      key,
      options.limit,
      options.window,
    );

    if (!isAllowed) {
      throw new HttpException(
        SYSTEM_ERRORS.RATE_LIMIT_EXCEEDED,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return true;
  }
}

/*
### 1. Tạo Decorator `@RateLimit`
Tôi đã tạo một decorator để bạn dễ dàng cấu hình limit (số lần) và window (thời gian tính bằng giây) cho từng API.
- **File:** `apps/api-gateway/src/common/guards/rate-limit.decorator.ts`

### 2. Tạo RateLimitGuard
Guard này sẽ thực hiện các bước sau:
1. Đọc cấu hình từ Decorator.
2. Xác định định danh người dùng: Nếu đã login thì dùng `userId`, nếu chưa thì dùng `IP`.
3. Gọi `rateLimitService.isAllowed()` để kiểm tra với Redis.
4. Nếu vượt quá giới hạn, sẽ ném ra lỗi `429 Too Many Requests`.
- **File:** `apps/api-gateway/src/common/guards/rate-limit.guard.ts`

### 3. Đăng ký Global Guard
Tôi đã đăng ký `RateLimitGuard` là một Global Guard trong `ApiGatewayModule`. Nghĩa là nó sẽ tự động quét mọi API, nhưng chỉ thực thi ở những chỗ bạn có gắn Decorator.

### 4. Áp dụng cho Auth Controller
Tôi đã áp dụng thử cho 2 API "nặng" nhất để bảo vệ CPU của bạn:
- **Login:** Giới hạn 5 lần / phút (`@RateLimit({ limit: 5, window: 60 })`).
- **Register:** Giới hạn 3 lần / phút (`@RateLimit({ limit: 3, window: 60 })`).

---

### Cách bạn sử dụng sau này:
Nếu bạn muốn giới hạn bất kỳ API nào khác, chỉ cần thêm decorator như sau:

```typescript
@RateLimit({ limit: 10, window: 60 }) // 10 lần mỗi phút
@Post('your-api')
yourMethod() { ... }
```
*/