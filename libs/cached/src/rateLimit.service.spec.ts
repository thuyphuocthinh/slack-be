import { Test, TestingModule } from '@nestjs/testing';
import { RateLimitService } from './rateLimit.service';

class FakeRedis {
  private store = new Map<
    string,
    { value: number; expiresAt: number | null }
  >();

  private isExpired(key: string): boolean {
    const entry = this.store.get(key);
    if (!entry) return true;
    if (entry.expiresAt !== null && Date.now() >= entry.expiresAt) {
      this.store.delete(key);
      return true;
    }
    return false;
  }

  async eval(
    _script: string,
    _numKeys: number,
    key: string,
    windowSec: number,
  ): Promise<number> {
    if (this.isExpired(key)) {
      this.store.set(key, {
        value: 1,
        expiresAt: Date.now() + windowSec * 1000,
      });
      return 1;
    }
    const entry = this.store.get(key)!;
    entry.value += 1;
    return entry.value;
  }
}

describe('RateLimitService', () => {
  let service: RateLimitService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RateLimitService,
        { provide: 'REDIS_CLIENT', useValue: new FakeRedis() },
      ],
    }).compile();

    service = module.get<RateLimitService>(RateLimitService);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('incrementInWindow', () => {
    it('returns 1 on the first call for a key', async () => {
      await expect(service.incrementInWindow('k1', 60)).resolves.toBe(1);
    });

    it('increments on each subsequent call within the window', async () => {
      await service.incrementInWindow('k1', 60);
      await service.incrementInWindow('k1', 60);
      await expect(service.incrementInWindow('k1', 60)).resolves.toBe(3);
    });

    it('resets to 1 once the window has elapsed', async () => {
      jest.useFakeTimers();
      await service.incrementInWindow('k1', 60);
      await service.incrementInWindow('k1', 60);

      await jest.advanceTimersByTimeAsync(60_001);

      await expect(service.incrementInWindow('k1', 60)).resolves.toBe(1);
    });

    it('keeps independent counters per key', async () => {
      await service.incrementInWindow('k1', 60);
      await service.incrementInWindow('k1', 60);

      await expect(service.incrementInWindow('k2', 60)).resolves.toBe(1);
    });
  });

  describe('isAllowed (regression — behavior must stay unchanged after refactor)', () => {
    it('allows calls while the count stays within limit', async () => {
      await expect(service.isAllowed('login:ip:1.1.1.1', 5, 60)).resolves.toBe(
        true,
      );
      await expect(service.isAllowed('login:ip:1.1.1.1', 5, 60)).resolves.toBe(
        true,
      );
    });

    it('blocks once the count exceeds the limit', async () => {
      for (let i = 0; i < 5; i++) {
        await service.isAllowed('login:ip:2.2.2.2', 5, 60);
      }

      await expect(service.isAllowed('login:ip:2.2.2.2', 5, 60)).resolves.toBe(
        false,
      );
    });
  });
});
