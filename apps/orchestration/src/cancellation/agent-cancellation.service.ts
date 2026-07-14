import { Injectable } from '@nestjs/common';
import { CACHE, CachedService } from '@slack/cached';

/**
 * Theo dõi quyền sở hữu + cờ huỷ của 1 lượt chat AI, khoá theo `replyMessageId`
 * (ID tin nhắn bot — cùng ID mà AgentStreamService/FE đã dùng xuyên suốt, không
 * cần map qua BullMQ jobId). Thuần Redis, không cần entity/migration riêng —
 * chỉ tồn tại trong lúc turn đang chạy.
 */
@Injectable()
export class AgentCancellationService {
  constructor(private readonly cached: CachedService) {}

  /** Gọi ngay khi turn bắt đầu chạy (handleAiTrigger) — ghi lại ai là chủ turn. */
  async startTurn(messageId: string, userId: string): Promise<void> {
    await this.cached.set(
      CACHE.ORCHESTRATION.KEYS.TURN_OWNER(messageId),
      userId,
      CACHE.ORCHESTRATION.SETTINGS.TURN_TTL,
    );
  }

  /** null = không tìm thấy turn nào đang chạy (đã xong từ lâu/TTL hết/chưa từng chạy). */
  async getOwner(messageId: string): Promise<string | null> {
    return this.cached.get<string>(CACHE.ORCHESTRATION.KEYS.TURN_OWNER(messageId));
  }

  /** Đánh dấu turn cần dừng — vòng lặp đang chạy tự phát hiện qua isCancelled(). */
  async requestCancel(messageId: string): Promise<void> {
    await this.cached.set(
      CACHE.ORCHESTRATION.KEYS.TURN_CANCEL(messageId),
      true,
      CACHE.ORCHESTRATION.SETTINGS.TURN_TTL,
    );
  }

  async isCancelled(messageId: string): Promise<boolean> {
    return this.cached.exists(CACHE.ORCHESTRATION.KEYS.TURN_CANCEL(messageId));
  }
}
