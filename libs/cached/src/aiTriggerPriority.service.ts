import { Injectable } from '@nestjs/common';
import { CACHE } from './cached.constant';
import { RateLimitService } from './rateLimit.service';

@Injectable()
export class AiTriggerPriorityService {
  constructor(private readonly rateLimit: RateLimitService) {}

  // Số lần workspace này trigger AI trong window gần đây — dùng cho cả việc
  // chặn workspace spam (admission) lẫn tính priority job (fair queueing),
  // nên trả về nguyên số đếm thô, không tự clamp/diễn giải ở đây.
  async countRecentTriggers(
    workspaceId: string,
    windowSec: number,
  ): Promise<number> {
    const key = CACHE.ORCHESTRATION.KEYS.WORKSPACE_TRIGGER_COUNT(workspaceId);
    return this.rateLimit.incrementInWindow(key, windowSec);
  }
}
