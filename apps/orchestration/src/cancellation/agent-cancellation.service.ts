import { Inject, Injectable } from '@nestjs/common';
import Redis from 'ioredis';
import { CACHE } from '@slack/cached';

/**
 * Theo dõi quyền sở hữu + cờ huỷ của 1 lượt chat AI, khoá theo `replyMessageId`
 * (ID tin nhắn bot — cùng ID mà AgentStreamService/FE đã dùng xuyên suốt, không
 * cần map qua BullMQ jobId). Thuần Redis, không cần entity/migration riêng —
 * chỉ tồn tại trong lúc turn đang chạy.
 *
 * Dùng thẳng Redis client (như RateLimitService), KHÔNG qua CachedService —
 * set()/exists() của CachedService nuốt mọi lỗi Redis và coi như thành công/
 * không tồn tại. Với 1 cache thật thì hợp lý, nhưng ở đây là quyền sở hữu +
 * cờ huỷ — nuốt lỗi nghĩa là Stop có thể "báo thành công" dù cờ chưa hề được
 * ghi, và vòng lặp AI không bao giờ thấy được để tự dừng. Để Redis lỗi thật
 * sự nổi lên, caller (cancelTurn()) mới báo lỗi rõ cho user thay vì im lặng.
 */
@Injectable()
export class AgentCancellationService {
  constructor(@Inject('REDIS_CLIENT') private readonly redis: Redis) {}

  /** Gọi ngay khi turn bắt đầu chạy (handleAiTrigger) — ghi lại ai là chủ turn. */
  async startTurn(messageId: string, userId: string): Promise<void> {
    await this.redis.set(
      CACHE.ORCHESTRATION.KEYS.TURN_OWNER(messageId),
      userId,
      'EX',
      CACHE.ORCHESTRATION.SETTINGS.TURN_TTL,
    );
  }

  /** null = không tìm thấy turn nào đang chạy (đã xong từ lâu/TTL hết/chưa từng chạy). */
  async getOwner(messageId: string): Promise<string | null> {
    return this.redis.get(CACHE.ORCHESTRATION.KEYS.TURN_OWNER(messageId));
  }

  /** Đánh dấu turn cần dừng — vòng lặp đang chạy tự phát hiện qua isCancelled(). */
  async requestCancel(messageId: string): Promise<void> {
    await this.redis.set(
      CACHE.ORCHESTRATION.KEYS.TURN_CANCEL(messageId),
      '1',
      'EX',
      CACHE.ORCHESTRATION.SETTINGS.TURN_TTL,
    );
  }

  async isCancelled(messageId: string): Promise<boolean> {
    return (
      (await this.redis.exists(
        CACHE.ORCHESTRATION.KEYS.TURN_CANCEL(messageId),
      )) === 1
    );
  }
}
