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
