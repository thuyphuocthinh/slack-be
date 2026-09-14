import { Test, TestingModule } from '@nestjs/testing';
import { CachedService } from './cached.service';

describe('CachedService.ping (Backpressure/Admission control — health-check)', () => {
  let service: CachedService;
  const mockRedis = { ping: jest.fn() };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CachedService,
        { provide: 'REDIS_CLIENT', useValue: mockRedis },
      ],
    }).compile();

    service = module.get<CachedService>(CachedService);
  });

  afterEach(() => jest.clearAllMocks());

  it('returns true when Redis replies PONG', async () => {
    mockRedis.ping.mockResolvedValue('PONG');

    await expect(service.ping()).resolves.toBe(true);
  });

  it('returns false when Redis is unreachable, instead of throwing', async () => {
    mockRedis.ping.mockRejectedValue(new Error('connect ECONNREFUSED'));

    await expect(service.ping()).resolves.toBe(false);
  });
});

describe('CachedService.getOrSetDetailNullable (negative caching)', () => {
  let service: CachedService;
  let store: Map<string, string>;

  const mockRedis = {
    get: jest.fn((key: string) => Promise.resolve(store.get(key) ?? null)),
    set: jest.fn((key: string, value: string) => {
      store.set(key, value);
      return Promise.resolve('OK');
    }),
  };

  beforeEach(async () => {
    store = new Map();
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CachedService,
        { provide: 'REDIS_CLIENT', useValue: mockRedis },
      ],
    }).compile();

    service = module.get<CachedService>(CachedService);
  });

  it('caches a null result instead of refetching every call (unlike getOrSetDetail)', async () => {
    const fetcher = jest.fn().mockResolvedValue(null);

    const first = await service.getOrSetDetailNullable('k1', 60, fetcher);
    const second = await service.getOrSetDetailNullable('k1', 60, fetcher);

    expect(first).toBeNull();
    expect(second).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('still caches and returns a real value normally', async () => {
    const fetcher = jest.fn().mockResolvedValue('view');

    const first = await service.getOrSetDetailNullable('k2', 60, fetcher);
    const second = await service.getOrSetDetailNullable('k2', 60, fetcher);

    expect(first).toBe('view');
    expect(second).toBe('view');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('dedupes concurrent calls for the same key (singleflight)', async () => {
    const fetcher = jest.fn().mockResolvedValue(null);

    // Gọi 2 lần liên tiếp không await giữa chừng — lần 2 phải "bắt" được lần 1
    // đang in-flight thay vì tự chạy fetcher() riêng.
    const [r1, r2] = await Promise.all([
      service.getOrSetDetailNullable('k3', 60, fetcher),
      service.getOrSetDetailNullable('k3', 60, fetcher),
    ]);

    expect(r1).toBeNull();
    expect(r2).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
