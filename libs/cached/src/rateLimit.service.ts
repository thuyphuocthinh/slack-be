import { Inject, Injectable } from '@nestjs/common';
import Redis from 'ioredis';

const INCREMENT_IN_WINDOW_SCRIPT = `
  local current = redis.call("INCR", KEYS[1])
  if current == 1 then
    redis.call("EXPIRE", KEYS[1], ARGV[1])
  end
  return current
`;

@Injectable()
export class RateLimitService {
  constructor(
    @Inject('REDIS_CLIENT')
    private readonly redis: Redis,
  ) {}

  // Đếm atomic trong 1 cửa sổ trượt (window giây) — trả về số lần gọi hiện
  // tại của key, tự hết hạn sau window giây kể từ lần gọi đầu tiên.
  async incrementInWindow(key: string, window: number): Promise<number> {
    return (await this.redis.eval(
      INCREMENT_IN_WINDOW_SCRIPT,
      1,
      key,
      window,
    )) as number;
  }

  /**
   * @param key ví dụ: login:ip:1.1.1.1
   * @param limit số lần tối đa
   * @param window seconds
   */
  async isAllowed(
    key: string,
    limit: number,
    window: number,
  ): Promise<boolean> {
    const count = await this.incrementInWindow(key, window);
    return count <= limit;
  }

  async getRemaining(key: string, limit: number): Promise<number> {
    const count = Number(await this.redis.get(key)) || 0;
    return Math.max(limit - count, 0);
  }
}
