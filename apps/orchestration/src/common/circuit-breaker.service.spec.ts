import { Test, TestingModule } from '@nestjs/testing';
import { RpcException } from '@nestjs/microservices';
import { ORCHESTRATION_CONSTANTS } from '@slack/constants';
import { CircuitBreakerService } from './circuit-breaker.service';
import { MetricsRegistryService } from './metrics-registry.service';

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

    await expect(service.run('mcp:flaky', action)).rejects.toThrow(
      'connect ECONNREFUSED',
    );
    await expect(service.run('mcp:flaky', action)).rejects.toThrow(
      'connect ECONNREFUSED',
    );

    expect(action).toHaveBeenCalledTimes(2);
  });

  it('opens the circuit after crossing the failure volume/percentage threshold, then fails fast WITHOUT calling the action again', async () => {
    const action = jest
      .fn()
      .mockRejectedValue(new Error('connect ECONNREFUSED'));

    // CIRCUIT_BREAKER_VOLUME_THRESHOLD = 3, 100% lỗi -> mở mạch ngay sau lần thứ 3.
    await expect(service.run('mcp:down', action)).rejects.toThrow(
      'connect ECONNREFUSED',
    );
    await expect(service.run('mcp:down', action)).rejects.toThrow(
      'connect ECONNREFUSED',
    );
    await expect(service.run('mcp:down', action)).rejects.toThrow(
      'connect ECONNREFUSED',
    );
    expect(action).toHaveBeenCalledTimes(3);

    const error = await service.run('mcp:down', action).catch((e) => e);

    expect(error).toBeInstanceOf(RpcException);
    expect((error as RpcException).getError()).toEqual(
      expect.objectContaining({
        code: 'ERR.ORCHESTRATION.0109',
        message: expect.stringContaining('key=mcp:down'),
      }),
    );
    expect(action).toHaveBeenCalledTimes(3); // KHÔNG tăng thêm — action không được gọi khi mạch đang OPEN
  });

  it('does not open the circuit when failures stay below the volume threshold', async () => {
    const action = jest.fn().mockRejectedValue(new Error('timeout'));

    await expect(service.run('mcp:sometimes', action)).rejects.toThrow(
      'timeout',
    );
    await expect(service.run('mcp:sometimes', action)).rejects.toThrow(
      'timeout',
    ); // 2 lần, dưới VOLUME_THRESHOLD=3

    action.mockResolvedValueOnce('recovered');
    const result = await service.run('mcp:sometimes', action);

    expect(result).toBe('recovered');
    expect(action).toHaveBeenCalledTimes(3);
  });

  it('half-opens and allows exactly one probe after resetTimeout, closing the circuit again when it succeeds', async () => {
    jest.useFakeTimers();
    const action = jest
      .fn()
      .mockRejectedValue(new Error('connect ECONNREFUSED'));

    await expect(service.run('mcp:recovering', action)).rejects.toThrow();
    await expect(service.run('mcp:recovering', action)).rejects.toThrow();
    await expect(service.run('mcp:recovering', action)).rejects.toThrow();
    await expect(service.run('mcp:recovering', action)).rejects.toThrow(
      'CIRCUIT BREAKER OPEN',
    ); // fail fast
    expect(action).toHaveBeenCalledTimes(3);

    await jest.advanceTimersByTimeAsync(
      ORCHESTRATION_CONSTANTS.CIRCUIT_BREAKER_RESET_TIMEOUT_MS + 1,
    );

    action.mockResolvedValueOnce('recovered');
    const result = await service.run('mcp:recovering', action);

    expect(result).toBe('recovered');
    expect(action).toHaveBeenCalledTimes(4); // probe (half-open) được cho qua

    // Mạch đã đóng lại — request tiếp theo chạy bình thường, không bị chặn nữa.
    action.mockResolvedValueOnce('ok again');
    const result2 = await service.run('mcp:recovering', action);
    expect(result2).toBe('ok again');
  });

  it('keeps independent circuits per key — a broken provider does not block a different provider/strategy', async () => {
    const brokenAction = jest.fn().mockRejectedValue(new Error('down'));
    const healthyAction = jest.fn().mockResolvedValue('ok');

    await expect(service.run('mcp:broken', brokenAction)).rejects.toThrow();
    await expect(service.run('mcp:broken', brokenAction)).rejects.toThrow();
    await expect(service.run('mcp:broken', brokenAction)).rejects.toThrow();
    await expect(service.run('mcp:broken', brokenAction)).rejects.toThrow(
      'CIRCUIT BREAKER OPEN',
    );

    const result = await service.run('llm:gemini', healthyAction);

    expect(result).toBe('ok');
    expect(healthyAction).toHaveBeenCalledTimes(1);
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
      await expect(service.run('mcp:down', action)).rejects.toThrow();
      await expect(service.run('mcp:down', action)).rejects.toThrow();
      await expect(service.run('mcp:down', action)).rejects.toThrow();

      expect(service.getStates()).toEqual({ 'mcp:down': 'open' });
    });

    it('reports "halfOpen" right after resetTimeout elapses, then "closed" once the probe succeeds', async () => {
      jest.useFakeTimers();
      const action = jest.fn().mockRejectedValue(new Error('down'));
      await expect(service.run('mcp:recovering', action)).rejects.toThrow();
      await expect(service.run('mcp:recovering', action)).rejects.toThrow();
      await expect(service.run('mcp:recovering', action)).rejects.toThrow();
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
      await expect(service.run('mcp:broken', brokenAction)).rejects.toThrow();
      await expect(service.run('mcp:broken', brokenAction)).rejects.toThrow();
      await expect(service.run('mcp:broken', brokenAction)).rejects.toThrow();

      expect(service.getStates()).toEqual({
        'mcp:healthy': 'closed',
        'mcp:broken': 'open',
      });
    });
  });
});
