import { Inject, Injectable } from '@nestjs/common';
import Redis from 'ioredis';

type TtlValue = number;

@Injectable()
export class CachedService {
  constructor(
    @Inject('REDIS_CLIENT')
    private readonly redis: Redis,
  ) {}

  // Utils

  private withJitter(ttl: number, percent = 0.1): number {
    const delta = ttl * percent;
    const jitter = Math.floor(Math.random() * delta);
    return ttl + jitter;
  }

  private serialize(value: any): string {
    return JSON.stringify(value);
  }

  private deserialize<T>(value: string | null): T | null {
    if (!value) return null;
    try {
      return JSON.parse(value) as T;
    } catch {
      return null;
    }
  }

  // Base cache

  async get<T>(key: string): Promise<T | null> {
    const data = await this.redis.get(key);
    return this.deserialize<T>(data);
  }

  async set(key: string, value: any, ttl: TtlValue): Promise<void> {
    const finalTtl = this.withJitter(ttl);
    await this.redis.set(key, this.serialize(value), 'EX', finalTtl);
  }

  async del(key: string): Promise<void> {
    await this.redis.del(key);
  }

  // Tracker (version)

  async getVersion(trackerKey: string): Promise<number> {
    const version = await this.redis.get(trackerKey);
    return version ? Number(version) : 1;
  }

  async bumpVersion(trackerKey: string): Promise<number> {
    return this.redis.incr(trackerKey);
  }

  // Detail cache

  async getOrSetDetail<T>(
    key: string,
    ttl: TtlValue,
    fetcher: () => Promise<T>,
  ): Promise<T> {
    const cached = await this.get<T>(key);
    if (cached) return cached;

    const data = await fetcher();

    // tránh cache null/undefined nếu cần
    if (data) {
      await this.set(key, data, ttl);
    }

    return data;
  }

  async invalidateDetail(key: string) {
    await this.del(key);
  }

  // List cache (version-based)

  async getOrSetList<T>(options: {
    trackerKey: string;
    keyBuilder: (version: number) => string;
    ttl: TtlValue;
    fetcher: () => Promise<T>;
  }): Promise<T> {
    const { trackerKey, keyBuilder, ttl, fetcher } = options;

    // 1. lấy version
    const version = await this.getVersion(trackerKey);

    // 2. build key
    const key = keyBuilder(version);

    // 3. check cache
    const cached = await this.get<T>(key);
    if (cached) return cached;

    // 4. fetch DB
    const data = await fetcher();

    // 5. set cache
    if (data) {
      await this.set(key, data, ttl);
    }

    return data;
  }

  async invalidateList(trackerKey: string) {
    await this.bumpVersion(trackerKey);
  }

  // write through
  async writeThrough<T>(key: string, ttl: TtlValue, fetcher: () => Promise<T>) {
    const data = await fetcher();
    await this.set(key, data, ttl);
    return data;
  }
}
