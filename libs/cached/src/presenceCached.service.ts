import { Inject, Injectable, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { CACHE } from './cached.constant';

@Injectable()
export class PresenceCacheService {
  private readonly logger = new Logger(PresenceCacheService.name);

  constructor(
    @Inject('REDIS_CLIENT')
    private readonly redis: Redis,
  ) {}

  /**
   * Cập nhật thời gian hoạt động cuối cùng của User
   */
  async registerConnection(userId: string, connectionId: string) {
    await this.updateConnection(userId, connectionId);
  }

  async refreshConnection(userId: string, connectionId: string) {
    await this.updateConnection(userId, connectionId);
  }

  private async updateConnection(userId: string, connectionId: string) {
    try {
      const statusKey = CACHE.PRESENCE.KEYS.USER_STATUS(userId);
      const connectionsKey = CACHE.PRESENCE.KEYS.USER_CONNECTIONS(userId);
      const now = Math.floor(Date.now() / 1000);
      const expiresAt = now + CACHE.PRESENCE.SETTINGS.ONLINE_THRESHOLD;
      const ttl = CACHE.PRESENCE.SETTINGS.REDIS_TTL;

      await this.redis.eval(
        `
          redis.call('ZREMRANGEBYSCORE', KEYS[2], '-inf', ARGV[1])
          redis.call('ZADD', KEYS[2], ARGV[2], ARGV[3])
          redis.call('EXPIRE', KEYS[2], ARGV[4])
          redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[4])
          return 1
        `,
        2,
        statusKey,
        connectionsKey,
        now,
        expiresAt,
        connectionId,
        ttl,
      );
    } catch (error) {
      this.logger.error(
        `updateConnection() failed for user ${userId}: ${error.message}`,
      );
    }
  }

  async removeConnection(userId: string, connectionId: string) {
    try {
      const statusKey = CACHE.PRESENCE.KEYS.USER_STATUS(userId);
      const connectionsKey = CACHE.PRESENCE.KEYS.USER_CONNECTIONS(userId);
      const now = Math.floor(Date.now() / 1000);

      return Number(
        await this.redis.eval(
          `
            redis.call('ZREM', KEYS[2], ARGV[2])
            redis.call('ZREMRANGEBYSCORE', KEYS[2], '-inf', ARGV[1])
            local remaining = redis.call('ZCARD', KEYS[2])
            if remaining == 0 then
              redis.call('DEL', KEYS[1], KEYS[2])
            end
            return remaining
          `,
          2,
          statusKey,
          connectionsKey,
          now,
          connectionId,
        ),
      );
    } catch (error) {
      this.logger.error(
        `removeConnection() failed for user ${userId}: ${error.message}`,
      );
      return 0;
    }
  }

  /**
   * Xóa trạng thái Online ngay lập tức (khi logout/disconnect sạch)
   */
  async removeStatus(userId: string) {
    try {
      await this.redis.del(
        CACHE.PRESENCE.KEYS.USER_STATUS(userId),
        CACHE.PRESENCE.KEYS.USER_CONNECTIONS(userId),
      );
    } catch (error) {
      this.logger.error(
        `removeStatus() failed for user ${userId}: ${error.message}`,
      );
    }
  }

  /**
   * Lấy trạng thái của danh sách User (hỗ trợ tới 100 người)
   */
  async getPresences(
    userIds: string[],
  ): Promise<Record<string, 'online' | 'offline'>> {
    if (userIds.length === 0) return {};

    const keys = userIds.map((id) => CACHE.PRESENCE.KEYS.USER_STATUS(id));
    const results = await this.redis.mget(...keys);

    const now = Math.floor(Date.now() / 1000);
    const threshold = CACHE.PRESENCE.SETTINGS.ONLINE_THRESHOLD;

    const presenceMap: Record<string, 'online' | 'offline'> = {};

    userIds.forEach((id, index) => {
      const lastSeenStr = results[index];
      if (!lastSeenStr) {
        presenceMap[id] = 'offline';
        return;
      }

      const lastSeen = parseInt(lastSeenStr, 10);
      // Nếu thời gian kể từ lần cuối "vẫy tay" nhỏ hơn ngưỡng quy định thì coi là Online
      presenceMap[id] = now - lastSeen < threshold ? 'online' : 'offline';
    });

    return presenceMap;
  }
}

/*
### 1. Phía Client (Frontend) gửi yêu cầu:
Khi User mở Workspace A, Frontend đã có danh sách ID của các thành viên trong Workspace đó (ví dụ lấy từ API `getMembers`). Frontend sẽ gom danh sách này lại (tối đa 100 ID) và gửi qua Socket:

```json
// Event: user_presence_get
{
  "userIds": ["user_abc_123", "user_xyz_456", "user_def_789", ...]
}
```

### 2. Phía Server xử lý:
Server nhận danh sách ID này, dùng lệnh `MGET` của Redis để lấy toàn bộ `last_seen` của các ID đó trong **duy nhất 1 lần truy vấn**. Sau đó tính toán xem ai Online/Offline dựa trên cái `threshold` (6 phút) đã cấu hình.

### 3. Phía Server phản hồi:
Server trả về một **Map (Object)** để Frontend dễ dàng mapping vào UI:

```json
{
  "status": "success",
  "presences": {
    "user_abc_123": "online",
    "user_xyz_456": "offline",
    "user_def_789": "online"
  }
}
```

### Tại sao lại dùng Map `id: status`?
*   **Tiết kiệm thời gian tìm kiếm ở Frontend:** Khi render Sidebar, Frontend chỉ cần làm: `status = presences[member.id]`. Độ phức tạp là $O(1)$, cực nhanh.
*   **Gọn nhẹ:** Chúng ta không cần gửi lại toàn bộ Object User phức tạp, chỉ cần ID và Trạng thái là đủ để UI "thắp sáng" cái chấm xanh.

### Tần suất gọi (Polling):
Frontend sẽ không gọi liên tục. Cứ khoảng **2-3 phút** nó mới gọi `user_presence_get` một lần để cập nhật lại "dàn chấm xanh" một lượt. Kết hợp với việc Heartbeat 5 phút, hệ thống sẽ cực kỳ nhẹ nhàng.

### Tận dụng "Realtime miễn phí" (Piggybacking)
Tuy bạn chỉ poll 30 phút/lần, nhưng UI vẫn có thể "thông minh" hơn bằng cách:

Bất cứ khi nào bạn nhận được tin nhắn từ User A, UI của bạn tự động bật cái chấm xanh của User A lên (vì rõ ràng họ vừa nhắn tin là họ đang Online).
Cách này giúp UI trông có vẻ Realtime mà không tốn thêm bất kỳ một request nào tới Server.

### Khi nào thì nên call user_presence_get?
Thay vì dùng setInterval cứng nhắc, chúng ta có thể call vào các thời điểm:

Khi mới mở App / Load Workspace.
Khi User chủ động nhấn nút "Refresh" (nếu có).
Khi chuyển đổi giữa các Workspace lớn.

*/
