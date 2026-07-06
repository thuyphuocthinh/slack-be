import { Inject, Injectable } from '@nestjs/common';
import Redis from 'ioredis';
import { CACHE } from './cached.constant';
import { hashToken } from '@slack/common';

@Injectable()
export class AuthCacheService {
  constructor(
    @Inject('REDIS_CLIENT')
    private readonly redis: Redis,
  ) {}

  // Blacklist token

  async blacklistToken(token: string, expiresIn: number) {
    const tokenHash = hashToken(token);
    const key = CACHE.AUTH.KEYS.BLACKLIST(tokenHash);
    await this.redis.set(key, '1', 'EX', expiresIn);
  }

  async isBlacklisted(token: string): Promise<boolean> {
    const tokenHash = hashToken(token);
    const key = CACHE.AUTH.KEYS.BLACKLIST(tokenHash);
    const exists = await this.redis.get(key);
    return !!exists;
  }

  // Token version (logout all)

  async setUserTokenVersion(userId: string, version: number) {
    const key = CACHE.AUTH.KEYS.TOKEN_VERSION(userId);
    await this.redis.set(key, version);
  }

  async getUserTokenVersion(userId: string): Promise<number> {
    const key = CACHE.AUTH.KEYS.TOKEN_VERSION(userId);
    const v = await this.redis.get(key);
    return v ? Number(v) : 1;
  }

  async bumpUserTokenVersion(userId: string) {
    const key = CACHE.AUTH.KEYS.TOKEN_VERSION(userId);
    return this.redis.incr(key);
  }

  // Refresh token rotation grace window

  async cacheRotationResult(
    oldRefreshToken: string,
    tokens: { accessToken: string; refreshToken: string },
  ) {
    const key = CACHE.AUTH.KEYS.ROTATION_GRACE(hashToken(oldRefreshToken));
    await this.redis.set(
      key,
      JSON.stringify(tokens),
      'EX',
      CACHE.AUTH.SETTINGS.ROTATION_GRACE_TTL,
    );
  }

  async getRotationResult(
    oldRefreshToken: string,
  ): Promise<{ accessToken: string; refreshToken: string } | null> {
    const key = CACHE.AUTH.KEYS.ROTATION_GRACE(hashToken(oldRefreshToken));
    const cached = await this.redis.get(key);
    return cached ? JSON.parse(cached) : null;
  }
}
