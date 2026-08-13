import { Test, TestingModule } from '@nestjs/testing';
import { RpcException } from '@nestjs/microservices';
import { ORCHESTRATION_CONSTANTS } from '@slack/constants';
import { CircuitBreakerService } from './circuit-breaker.service';
import { MetricsRegistryService } from './metrics-registry.service';
import { CIRCUIT_BREAKER_REPORT_SCRIPT } from './circuit-breaker.lua';

const VOLUME_THRESHOLD =
  ORCHESTRATION_CONSTANTS.CIRCUIT_BREAKER_VOLUME_THRESHOLD;

class FakeRedis {
  private store = new Map<string, { value: string; expiresAt: number | null }>();

  private isExpired(key: string): boolean {
    const entry = this.store.get(key);
    if (!entry) return true;
    if (entry.expiresAt !== null && Date.now() >= entry.expiresAt) {
      this.store.delete(key);
      return true;
    }
    return false;
  }

  async get(key: string): Promise<string | null> {
    if (this.isExpired(key)) return null;
    return this.store.get(key)!.value;
  }

  async set(key: string, value: unknown, ...args: unknown[]): Promise<string | null> {
    let px: number | null = null;
    let nx = false;
    for (let i = 0; i < args.length; i++) {
      if (args[i] === 'PX') px = Number(args[i + 1]);
      if (args[i] === 'NX') nx = true;
    }
    if (nx && !this.isExpired(key)) return null;
    this.store.set(key, {
      value: String(value),
      expiresAt: px !== null ? Date.now() + px : null,
    });
    return 'OK';
  }

  async del(...keys: string[]): Promise<number> {
    let count = 0;
    for (const key of keys) {
      if (this.store.delete(key)) count++;
    }
    return count;
  }

  async eval(script: string, numKeys: number, ...rest: unknown[]): Promise<string> {
    const keys = rest.slice(0, numKeys) as string[];
    const argv = rest.slice(numKeys) as string[];

    if (script !== CIRCUIT_BREAKER_REPORT_SCRIPT) {
      throw new Error('unknown script');
    }

    const [totalKey, failuresKey, stateKey, openedAtKey] = keys;
    const [windowSec, isFailure, volumeThreshold, errorThresholdPct, now] = argv;

    const total = this.rawIncr(totalKey);
    if (total === 1) this.rawExpire(totalKey, Number(windowSec));

    if (isFailure === '1') {
      const failures = this.rawIncr(failuresKey);
      if (failures === 1) this.rawExpire(failuresKey, Number(windowSec));

      if (
        total >= Number(volumeThreshold) &&
        (failures * 100) / total >= Number(errorThresholdPct)
      ) {
        this.rawSet(stateKey, 'open');
        this.rawSet(openedAtKey, now);
        this.store.delete(totalKey);
        this.store.delete(failuresKey);
        return 'open';
      }
    }

    return 'closed';
  }

  private rawIncr(key: string): number {
    this.isExpired(key);
    const entry = this.store.get(key);
    const next = (entry ? Number(entry.value) : 0) + 1;
    this.store.set(key, { value: String(next), expiresAt: entry?.expiresAt ?? null });
    return next;
  }

  private rawExpire(key: string, sec: number): void {
    const entry = this.store.get(key);
    if (entry) entry.expiresAt = Date.now() + sec * 1000;
  }

  private rawSet(key: string, value: unknown): void {
    const entry = this.store.get(key);
    this.store.set(key, { value: String(value), expiresAt: entry?.expiresAt ?? null });
  }
}

async function tripCircuit(
  service: CircuitBreakerService,
  key: string,
  action: jest.Mock,
): Promise<void> {
  for (let i = 0; i < VOLUME_THRESHOLD; i++) {
    await expect(service.run(key, action)).rejects.toThrow();
  }
}

describe('CircuitBreakerService', () => {
  let service: CircuitBreakerService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CircuitBreakerService,
        MetricsRegistryService,
        { provide: 'REDIS_CLIENT', useValue: new FakeRedis() },
      ],
    }).compile();

    service = module.get<CircuitBreakerService>(CircuitBreakerService);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('resolves normally when the action succeeds (circuit closed)', async () => {
    const action = jest.fn().mockResolvedValue('ok');

    const result = await service.run('mcp:sql_server', action);

    expect(result).toBe('ok');
    expect(action).toHaveBeenCalledTimes(1);
  });

  it('propagates the real error for each failing call while still under the volume threshold', async () => {
    const action = jest
      .fn()
      .mockRejectedValue(new Error('connect ECONNREFUSED'));

    for (let i = 0; i < VOLUME_THRESHOLD - 1; i++) {
      await expect(service.run('mcp:flaky', action)).rejects.toThrow(
        'connect ECONNREFUSED',
      );
    }

    expect(action).toHaveBeenCalledTimes(VOLUME_THRESHOLD - 1);
  });

  it('opens the circuit after crossing the failure volume/percentage threshold, then fails fast WITHOUT calling the action again', async () => {
    const action = jest
      .fn()
      .mockRejectedValue(new Error('connect ECONNREFUSED'));

    await tripCircuit(service, 'mcp:down', action);
    expect(action).toHaveBeenCalledTimes(VOLUME_THRESHOLD);

    const error = await service.run('mcp:down', action).catch((e) => e);

    expect(error).toBeInstanceOf(RpcException);
    expect((error as RpcException).getError()).toEqual(
      expect.objectContaining({
        code: 'ERR.ORCHESTRATION.0109',
        message: expect.stringContaining('key=mcp:down'),
      }),
    );
    expect(action).toHaveBeenCalledTimes(VOLUME_THRESHOLD);
  });

  it('does not open the circuit when failures stay below the volume threshold', async () => {
    const action = jest.fn().mockRejectedValue(new Error('timeout'));

    for (let i = 0; i < VOLUME_THRESHOLD - 1; i++) {
      await expect(service.run('mcp:sometimes', action)).rejects.toThrow(
        'timeout',
      );
    }

    action.mockResolvedValueOnce('recovered');
    const result = await service.run('mcp:sometimes', action);

    expect(result).toBe('recovered');
    expect(action).toHaveBeenCalledTimes(VOLUME_THRESHOLD);
  });

  it('half-opens and allows exactly one probe after resetTimeout, closing the circuit again when it succeeds', async () => {
    jest.useFakeTimers();
    const action = jest
      .fn()
      .mockRejectedValue(new Error('connect ECONNREFUSED'));

    await tripCircuit(service, 'mcp:recovering', action);
    await expect(service.run('mcp:recovering', action)).rejects.toThrow(
      'CIRCUIT BREAKER OPEN',
    );
    expect(action).toHaveBeenCalledTimes(VOLUME_THRESHOLD);

    await jest.advanceTimersByTimeAsync(
      ORCHESTRATION_CONSTANTS.CIRCUIT_BREAKER_RESET_TIMEOUT_MS + 1,
    );

    action.mockResolvedValueOnce('recovered');
    const result = await service.run('mcp:recovering', action);

    expect(result).toBe('recovered');
    expect(action).toHaveBeenCalledTimes(VOLUME_THRESHOLD + 1);

    action.mockResolvedValueOnce('ok again');
    const result2 = await service.run('mcp:recovering', action);
    expect(result2).toBe('ok again');
  });

  it('only lets ONE instance through as the half-open probe when 2 requests race the same key', async () => {
    jest.useFakeTimers();
    const failing = jest
      .fn()
      .mockRejectedValue(new Error('connect ECONNREFUSED'));
    await tripCircuit(service, 'mcp:racing', failing);
    await jest.advanceTimersByTimeAsync(
      ORCHESTRATION_CONSTANTS.CIRCUIT_BREAKER_RESET_TIMEOUT_MS + 1,
    );

    const probe = jest.fn(
      () => new Promise((resolve) => setTimeout(() => resolve('probe ok'), 10)),
    );
    const first = service.run('mcp:racing', probe);
    const second = service.run('mcp:racing', probe).catch((e) => e);

    const secondError = await second;
    expect(secondError).toBeInstanceOf(RpcException);
    expect((secondError as RpcException).getError()).toEqual(
      expect.objectContaining({ code: 'ERR.ORCHESTRATION.0109' }),
    );

    await jest.advanceTimersByTimeAsync(10);
    await expect(first).resolves.toBe('probe ok');
  });

  it('keeps independent circuits per key — a broken provider does not block a different provider/strategy', async () => {
    const brokenAction = jest.fn().mockRejectedValue(new Error('down'));
    const healthyAction = jest.fn().mockResolvedValue('ok');

    await tripCircuit(service, 'mcp:broken', brokenAction);
    await expect(service.run('mcp:broken', brokenAction)).rejects.toThrow(
      'CIRCUIT BREAKER OPEN',
    );

    const result = await service.run('llm:gemini', healthyAction);

    expect(result).toBe('ok');
    expect(healthyAction).toHaveBeenCalledTimes(1);
  });

  describe('cancellation (Stop giữa chừng không được tính là lỗi provider thật)', () => {
    it('does not open the circuit when every failure was caused by the caller aborting its own signal', async () => {
      const controller = new AbortController();
      controller.abort();
      const action = jest.fn().mockRejectedValue(new Error('Aborted'));

      for (let i = 0; i < VOLUME_THRESHOLD; i++) {
        await expect(
          service.run('llm:gemini', action, controller.signal),
        ).rejects.toThrow('Aborted');
      }

      await expect(service.getStates()).resolves.toEqual({
        'llm:gemini': 'closed',
      });
    });

    it('still opens the circuit for a real failure even when a (non-aborted) signal is passed', async () => {
      const controller = new AbortController();
      const action = jest
        .fn()
        .mockRejectedValue(new Error('connect ECONNREFUSED'));

      for (let i = 0; i < VOLUME_THRESHOLD; i++) {
        await expect(
          service.run('llm:gemini', action, controller.signal),
        ).rejects.toThrow('connect ECONNREFUSED');
      }

      await expect(service.getStates()).resolves.toEqual({
        'llm:gemini': 'open',
      });
    });
  });

  describe('getStates (Backpressure/Admission control)', () => {
    it('returns an empty object before any breaker has been created', async () => {
      await expect(service.getStates()).resolves.toEqual({});
    });

    it('reports "closed" for a breaker that has only succeeded', async () => {
      await service.run('mcp:sql_server', jest.fn().mockResolvedValue('ok'));

      await expect(service.getStates()).resolves.toEqual({
        'mcp:sql_server': 'closed',
      });
    });

    it('reports "open" once the circuit trips', async () => {
      const action = jest.fn().mockRejectedValue(new Error('down'));
      await tripCircuit(service, 'mcp:down', action);

      await expect(service.getStates()).resolves.toEqual({
        'mcp:down': 'open',
      });
    });

    it('reports "halfOpen" right after resetTimeout elapses, then "closed" once the probe succeeds', async () => {
      jest.useFakeTimers();
      const action = jest.fn().mockRejectedValue(new Error('down'));
      await tripCircuit(service, 'mcp:recovering', action);
      await expect(service.getStates()).resolves.toEqual({
        'mcp:recovering': 'open',
      });

      await jest.advanceTimersByTimeAsync(
        ORCHESTRATION_CONSTANTS.CIRCUIT_BREAKER_RESET_TIMEOUT_MS + 1,
      );

      const probe = jest.fn(
        () => new Promise((resolve) => setTimeout(() => resolve('recovered'), 10)),
      );
      const runPromise = service.run('mcp:recovering', probe);

      await jest.advanceTimersByTimeAsync(0);
      await expect(service.getStates()).resolves.toEqual({
        'mcp:recovering': 'halfOpen',
      });

      await jest.advanceTimersByTimeAsync(10);
      await expect(runPromise).resolves.toBe('recovered');
      await expect(service.getStates()).resolves.toEqual({
        'mcp:recovering': 'closed',
      });
    });

    it('keeps independent states per key', async () => {
      await service.run('mcp:healthy', jest.fn().mockResolvedValue('ok'));
      const brokenAction = jest.fn().mockRejectedValue(new Error('down'));
      await tripCircuit(service, 'mcp:broken', brokenAction);

      await expect(service.getStates()).resolves.toEqual({
        'mcp:healthy': 'closed',
        'mcp:broken': 'open',
      });
    });
  });
});
