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
    const luaScript = `
      local current = redis.call("INCR", KEYS[1])
      if current == 1 then
        redis.call("EXPIRE", KEYS[1], ARGV[1])
      end
      return current
    `;

    const count = (await this.redis.eval(
      luaScript,
      1,
      key,
      window,
    )) as number;

    return count <= limit;
  }

  async getRemaining(key: string, limit: number): Promise<number> {
    const count = Number(await this.redis.get(key)) || 0;
    return Math.max(limit - count, 0);
  }
}
