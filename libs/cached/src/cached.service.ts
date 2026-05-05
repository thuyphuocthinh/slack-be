import { Inject, Injectable, Logger } from '@nestjs/common';
import Redis from 'ioredis';

type TtlValue = number;

@Injectable()
export class CachedService {
  private readonly logger = new Logger(CachedService.name);
  constructor(
    @Inject('REDIS_CLIENT')
    private readonly redis: Redis,
  ) { }

  private inFlightRequests = new Map<string, Promise<any>>();

  async exists(key: string): Promise<boolean> {
    try {
      return (await this.redis.exists(key)) === 1;
    } catch (error) {
      this.logger.error(`Redis exists error: ${error.message}`);
      return false;
    }
  }

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
    try {
      const data = await this.redis.get(key);
      return this.deserialize<T>(data);
    } catch (error) {
      this.logger.error(`Redis get error: ${error.message}`);
      return null;
    }
  }

  async set(key: string, value: any, ttl: TtlValue): Promise<void> {
    try {
      const finalTtl = this.withJitter(ttl);
      await this.redis.set(key, this.serialize(value), 'EX', finalTtl);
    } catch (error) {
      this.logger.error(`Redis set error: ${error.message}`);
    }
  }

  async del(key: string): Promise<void> {
    try {
      await this.redis.del(key);
    } catch (error) {
      this.logger.error(`Redis del error: ${error.message}`);
    }
  }

  // Tracker (version)

  async getVersion(trackerKey: string): Promise<number> {
    const version = await this.redis.get(trackerKey);
    return version ? Number(version) : 0;
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
    // 1. Check cache
    const cached = await this.get<T>(key);
    if (cached) return cached;

    // 2. Singleflight: Check if a fetch for this key is already in progress
    if (this.inFlightRequests.has(key)) {
      this.logger.debug(`Singleflight: Waiting for in-flight request for key: ${key}`);
      return this.inFlightRequests.get(key);
    }

    // 3. Perform fetch and store promise
    const fetchPromise = fetcher().then(async (data) => {
      if (data) {
        await this.set(key, data, ttl);
      }
      this.inFlightRequests.delete(key);
      return data;
    }).catch(err => {
      this.inFlightRequests.delete(key);
      throw err;
    });

    this.inFlightRequests.set(key, fetchPromise);
    return fetchPromise;
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

    const version = await this.getVersion(trackerKey);
    const key = keyBuilder(version);

    // Sử dụng logic Singleflight thông qua getOrSetDetail
    return this.getOrSetDetail(key, ttl, fetcher);
  }

  async invalidateList(trackerKey: string) {
    await this.bumpVersion(trackerKey);
  }

  async invalidateListBulk(trackerKeys: string[]) {
    if (!trackerKeys.length) return;
    const pipeline = this.redis.pipeline();
    trackerKeys.forEach((key) => pipeline.incr(key));
    await pipeline.exec();
  }

  // set data type
  async setSet(key: string, value: string, ttl: TtlValue): Promise<void> {
    const finalTtl = this.withJitter(ttl);
    await this.redis.sadd(key, value);
    await this.redis.expire(key, finalTtl);
  }

  async getSet(key: string): Promise<string[] | null> {
    const data = await this.redis.smembers(key);
    return data;
  }

  async removeFromSet(key: string, value: string): Promise<void> {
    await this.redis.srem(key, value);
  }

  async isMemberOfSet(key: string, member: string): Promise<boolean> {
    return (await this.redis.sismember(key, member)) === 1;
  }

  // write through
  async writeThrough<T>(key: string, ttl: TtlValue, fetcher: () => Promise<T>) {
    const data = await fetcher();
    await this.set(key, data, ttl);
    return data;
  }
}
