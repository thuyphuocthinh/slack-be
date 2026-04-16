import { Global, Module } from '@nestjs/common';
import { CachedService } from './cached.service';
import Redis from 'ioredis';
import { RateLimitService } from './rateLimit.service';
import { AuthCacheService } from './authCached.service';

@Global()
@Module({
  providers: [
    CachedService,
    RateLimitService,
    AuthCacheService,
    {
      provide: 'REDIS_CLIENT',
      useFactory() {
        return new Redis({
          host: process.env.REDIS_HOST,
          port: Number(process.env.REDIS_PORT),
          password: process.env.REDIS_PASSWORD,
        });
      },
    },
  ],
  exports: [CachedService, RateLimitService, AuthCacheService],
})
export class CachedModule {}
