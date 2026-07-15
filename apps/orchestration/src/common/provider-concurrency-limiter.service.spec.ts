import { ProviderConcurrencyLimiterService } from './provider-concurrency-limiter.service';

// Flush cả microtask lẫn macrotask đang chờ — an toàn hơn await Promise.resolve()
// đơn lẻ vì không cần đếm chính xác bao nhiêu tick nội bộ acquire()/release() dùng.
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('ProviderConcurrencyLimiterService', () => {
  let service: ProviderConcurrencyLimiterService;

  beforeEach(() => {
    service = new ProviderConcurrencyLimiterService();
  });

  it('runs the action immediately when under the concurrency limit', async () => {
    let ran = false;
    await service.run('mcp:sql_server', 3, async () => {
      ran = true;
    });
    expect(ran).toBe(true);
  });

  it('queues calls beyond maxConcurrent and lets them through one at a time, in FIFO order, only as earlier ones release', async () => {
    const started: number[] = [];
    const finished: number[] = [];
    const release: Array<() => void> = [];

    const runTask = (id: number) =>
      service.run('mcp:sql_server', 1, () => {
        started.push(id);
        return new Promise<void>((resolve) => release.push(resolve)).then(
          () => {
            finished.push(id);
          },
        );
      });

    const p1 = runTask(1);
    const p2 = runTask(2);
    const p3 = runTask(3);
    await flush();
    // maxConcurrent=1 — chỉ task đầu tiên được chạy thật, 2 task còn lại đợi slot.
    expect(started).toEqual([1]);

    release[0]();
    await flush();
    expect(started).toEqual([1, 2]);

    release[1]();
    await flush();
    expect(started).toEqual([1, 2, 3]);

    release[2]();
    await Promise.all([p1, p2, p3]);
    expect(finished).toEqual([1, 2, 3]);
  });

  it('does not block calls under a different key (per-provider isolation)', async () => {
    let releaseBlocked: () => void = () => {};
    const blocked = service.run(
      'mcp:sql_server',
      1,
      () => new Promise<void>((resolve) => (releaseBlocked = resolve)),
    );
    await flush();

    let otherRan = false;
    await service.run('mcp:github', 1, async () => {
      otherRan = true;
    });

    expect(otherRan).toBe(true);
    releaseBlocked();
    await blocked;
  });

  it('releases the slot even when the action throws, so the next call is not stuck waiting forever', async () => {
    await expect(
      service.run('mcp:sql_server', 1, async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    let ran = false;
    await service.run('mcp:sql_server', 1, async () => {
      ran = true;
    });
    expect(ran).toBe(true);
  });
});
