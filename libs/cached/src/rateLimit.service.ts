import { Inject, Injectable } from '@nestjs/common';
import Redis from 'ioredis';

@Injectable()
export class RateLimitService {
  constructor(
    @Inject('REDIS_CLIENT')
    private readonly redis: Redis,
  ) {}

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
    const count = await this.redis.incr(key);

    // set expire lần đầu
    if (count === 1) {
      await this.redis.expire(key, window);
    }

    return count <= limit;
  }

  async getRemaining(key: string, limit: number): Promise<number> {
    const count = Number(await this.redis.get(key)) || 0;
    return Math.max(limit - count, 0);
  }
}
