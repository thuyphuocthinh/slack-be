import { Test, TestingModule } from '@nestjs/testing';
import { RpcException } from '@nestjs/microservices';
import { ORCHESTRATION_CONSTANTS } from '@slack/constants';
import { CircuitBreakerService } from './circuit-breaker.service';
import { MetricsRegistryService } from './metrics-registry.service';

const VOLUME_THRESHOLD =
  ORCHESTRATION_CONSTANTS.CIRCUIT_BREAKER_VOLUME_THRESHOLD;

// performance_problem.md mục 1 — số lần cần thiết để mở mạch đọc THẲNG từ
// constant (không hardcode), để việc tinh chỉnh VOLUME_THRESHOLD sau này
// không làm sai lệch ý nghĩa của các test này.
async function tripCircuit(
  service: CircuitBreakerService,
  key: string,
  action: jest.Mock,
): Promise<void> {
  for (let i = 0; i < VOLUME_THRESHOLD; i++) {
    await expect(service.run(key, action)).rejects.toThrow();
  }
}

describe('CircuitBreakerService (Giai đoạn 4, Step 6)', () => {
  let service: CircuitBreakerService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [CircuitBreakerService, MetricsRegistryService],
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

    // 100% lỗi -> mở mạch ngay sau đủ VOLUME_THRESHOLD lần.
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
    expect(action).toHaveBeenCalledTimes(VOLUME_THRESHOLD); // KHÔNG tăng thêm — action không được gọi khi mạch đang OPEN
  });

  it('does not open the circuit when failures stay below the volume threshold', async () => {
    const action = jest.fn().mockRejectedValue(new Error('timeout'));

    for (let i = 0; i < VOLUME_THRESHOLD - 1; i++) {
      await expect(service.run('mcp:sometimes', action)).rejects.toThrow(
        'timeout',
      ); // dưới VOLUME_THRESHOLD, chưa đủ để mở mạch
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
    ); // fail fast
    expect(action).toHaveBeenCalledTimes(VOLUME_THRESHOLD);

    await jest.advanceTimersByTimeAsync(
      ORCHESTRATION_CONSTANTS.CIRCUIT_BREAKER_RESET_TIMEOUT_MS + 1,
    );

    action.mockResolvedValueOnce('recovered');
    const result = await service.run('mcp:recovering', action);

    expect(result).toBe('recovered');
    expect(action).toHaveBeenCalledTimes(VOLUME_THRESHOLD + 1); // probe (half-open) được cho qua

    // Mạch đã đóng lại — request tiếp theo chạy bình thường, không bị chặn nữa.
    action.mockResolvedValueOnce('ok again');
    const result2 = await service.run('mcp:recovering', action);
    expect(result2).toBe('ok again');
  });

  it('bug fix — wraps the raw opossum error into RpcException when a 2nd call races the half-open probe', async () => {
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

  describe('cancellation (bug fix — Stop giữa chừng không được tính là lỗi provider thật)', () => {
    it('does not open the circuit when every failure was caused by the caller aborting its own signal', async () => {
      const controller = new AbortController();
      controller.abort();
      const action = jest.fn().mockRejectedValue(new Error('Aborted'));

      for (let i = 0; i < VOLUME_THRESHOLD; i++) {
        await expect(
          service.run('llm:gemini', action, controller.signal),
        ).rejects.toThrow('Aborted');
      }

      expect(service.getStates()).toEqual({ 'llm:gemini': 'closed' });
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

      expect(service.getStates()).toEqual({ 'llm:gemini': 'open' });
    });
  });

  describe('getStates (Backpressure/Admission control)', () => {
    it('returns an empty object before any breaker has been created', () => {
      expect(service.getStates()).toEqual({});
    });

    it('reports "closed" for a breaker that has only succeeded', async () => {
      await service.run('mcp:sql_server', jest.fn().mockResolvedValue('ok'));

      expect(service.getStates()).toEqual({ 'mcp:sql_server': 'closed' });
    });

    it('reports "open" once the circuit trips', async () => {
      const action = jest.fn().mockRejectedValue(new Error('down'));
      await tripCircuit(service, 'mcp:down', action);

      expect(service.getStates()).toEqual({ 'mcp:down': 'open' });
    });

    it('reports "halfOpen" right after resetTimeout elapses, then "closed" once the probe succeeds', async () => {
      jest.useFakeTimers();
      const action = jest.fn().mockRejectedValue(new Error('down'));
      await tripCircuit(service, 'mcp:recovering', action);
      expect(service.getStates()).toEqual({ 'mcp:recovering': 'open' });

      await jest.advanceTimersByTimeAsync(
        ORCHESTRATION_CONSTANTS.CIRCUIT_BREAKER_RESET_TIMEOUT_MS + 1,
      );
      expect(service.getStates()).toEqual({ 'mcp:recovering': 'halfOpen' });

      action.mockResolvedValueOnce('recovered');
      await service.run('mcp:recovering', action);
      expect(service.getStates()).toEqual({ 'mcp:recovering': 'closed' });
    });

    it('keeps independent states per key', async () => {
      await service.run('mcp:healthy', jest.fn().mockResolvedValue('ok'));
      const brokenAction = jest.fn().mockRejectedValue(new Error('down'));
      await tripCircuit(service, 'mcp:broken', brokenAction);

      expect(service.getStates()).toEqual({
        'mcp:healthy': 'closed',
        'mcp:broken': 'open',
      });
    });
  });
});
