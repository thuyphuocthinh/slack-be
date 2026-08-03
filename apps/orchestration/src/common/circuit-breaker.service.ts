import { Inject, Injectable, Logger } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import Redis from 'ioredis';
import { CACHE } from '@slack/cached';
import { ECircuitBreaker, ORCHESTRATION_CONSTANTS, ORCHESTRATION_ERROR } from '@slack/constants';
import { MetricsRegistryService } from './metrics-registry.service';
import { CIRCUIT_BREAKER_REPORT_SCRIPT } from './circuit-breaker.lua';

const KEYS = CACHE.ORCHESTRATION.KEYS;

const ABORTED_BY_CALLER = Symbol('circuit-breaker-aborted-by-caller');

interface TaggableError {
  [ABORTED_BY_CALLER]?: true;
}

// "Probe" = request thử/dò xem provider đã sống lại chưa 

/**
 * Tóm gọn cách chia key: mỗi provider MCP (mcp:sql_server, mcp:notion...) và mỗi strategy LLM (llm:gemini, llm:gpt4o...) có 1 mạch riêng — 
 * provider này chết không ảnh hưởng provider khác, đúng nguyên lý ban đầu bàn (test "keeps independent circuits per key" cũng verify đúng điều này).
 */
type AcquireDecision = 'ALLOWED' | 'PROBE' | 'OPEN';

@Injectable()
export class CircuitBreakerService {
  private readonly logger = new Logger(CircuitBreakerService.name);
  private readonly knownKeys = new Set<string>();

  constructor(
    @Inject('REDIS_CLIENT') private readonly redis: Redis,
    private readonly metrics: MetricsRegistryService,
  ) { }

  async run<T>(
    key: string,
    action: () => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    this.knownKeys.add(key);
    const decision = await this.acquire(key);

    if (decision === 'OPEN') {
      throw this.buildOpenError(key);
    }

    try {
      const result = await this.runTagged(action, signal);
      await this.report(key, decision === 'PROBE', true);
      return result;
    } catch (error) {
      const aborted = (error as TaggableError)[ABORTED_BY_CALLER] === true;
      if (aborted) {
        if (decision === 'PROBE') {
          await this.redis.del(KEYS.CIRCUIT_BREAKER_PROBE_LOCK(key));
        }
      } else {
        await this.report(key, decision === 'PROBE', false);
      }
      throw error;
    }
  }

  async getStates(): Promise<Record<string, ECircuitBreaker>> {
    const entries = await Promise.all(
      Array.from(this.knownKeys).map(
        async (key) => [key, await this.getState(key)] as const,
      ),
    );
    return Object.fromEntries(entries);
  }

  private buildOpenError(key: string): RpcException {
    this.logger.warn(`run() key=${key} bị chặn — circuit đang OPEN`);
    return new RpcException({
      ...ORCHESTRATION_ERROR.CIRCUIT_BREAKER_OPEN,
      message: `${ORCHESTRATION_ERROR.CIRCUIT_BREAKER_OPEN.message} (key=${key})`,
    });
  }

  private async runTagged<T>(
    action: () => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    try {
      return await action();
    } catch (error) {
      if (signal?.aborted) {
        (error as TaggableError)[ABORTED_BY_CALLER] = true;
      }
      throw error;
    }
  }

  private async acquire(key: string): Promise<AcquireDecision> {
    const state = await this.redis.get(KEYS.CIRCUIT_BREAKER_STATE(key));

    if (state !== ECircuitBreaker.OPEN && state !== ECircuitBreaker.HALF_OPEN) {
      return 'ALLOWED';
    }

    if (state === ECircuitBreaker.OPEN) {
      const openedAt = Number(await this.redis.get(KEYS.CIRCUIT_BREAKER_OPENED_AT(key))) || 0;
      if (Date.now() - openedAt < ORCHESTRATION_CONSTANTS.CIRCUIT_BREAKER_RESET_TIMEOUT_MS) {
        return 'OPEN';
      }
    }

    /**
     * "Tao muốn giành quyền làm request thử (probe) — nếu chưa ai giành thì tao giành được (NX thành công, trả 'OK'), 
     * và quyền này tự hết hạn sau 60s dù tao có quên giải phóng (PX, phòng khi instance giữ lock bị crash giữa đường thì lock không kẹt vĩnh viễn)."
     */

    const acquired = await this.redis.set(
      KEYS.CIRCUIT_BREAKER_PROBE_LOCK(key),
      '1',
      'PX',
      ORCHESTRATION_CONSTANTS.CIRCUIT_BREAKER_PROBE_LOCK_TTL_MS,
      'NX',
    );
    if (!acquired) {
      return 'OPEN';
    }

    await this.redis.set(KEYS.CIRCUIT_BREAKER_STATE(key), ECircuitBreaker.HALF_OPEN);
    return 'PROBE';
  }

  private async report(
    key: string,
    wasProbe: boolean,
    success: boolean,
  ): Promise<void> {
    const prevState = await this.getState(key);
    let nextState: ECircuitBreaker;

    if (wasProbe) {
      await this.redis.del(KEYS.CIRCUIT_BREAKER_PROBE_LOCK(key));
      if (success) {
        await this.redis.del(
          KEYS.CIRCUIT_BREAKER_STATE(key),
          KEYS.CIRCUIT_BREAKER_OPENED_AT(key),
          KEYS.CIRCUIT_BREAKER_TOTAL(key),
          KEYS.CIRCUIT_BREAKER_FAILURES(key),
        );
        nextState = ECircuitBreaker.CLOSED;
      } else {
        await this.redis.set(KEYS.CIRCUIT_BREAKER_STATE(key), ECircuitBreaker.OPEN);
        await this.redis.set(KEYS.CIRCUIT_BREAKER_OPENED_AT(key), Date.now());
        nextState = ECircuitBreaker.OPEN;
      }
    } else {
      const result = await this.redis.eval(
        CIRCUIT_BREAKER_REPORT_SCRIPT,
        4,
        KEYS.CIRCUIT_BREAKER_TOTAL(key),
        KEYS.CIRCUIT_BREAKER_FAILURES(key),
        KEYS.CIRCUIT_BREAKER_STATE(key),
        KEYS.CIRCUIT_BREAKER_OPENED_AT(key),
        ORCHESTRATION_CONSTANTS.CIRCUIT_BREAKER_VOLUME_WINDOW_SEC,
        success ? '0' : '1',
        ORCHESTRATION_CONSTANTS.CIRCUIT_BREAKER_VOLUME_THRESHOLD,
        ORCHESTRATION_CONSTANTS.CIRCUIT_BREAKER_ERROR_THRESHOLD_PERCENTAGE,
        Date.now(),
      );
      nextState =
        result === ECircuitBreaker.OPEN
          ? ECircuitBreaker.OPEN
          : ECircuitBreaker.CLOSED;
    }

    if (nextState !== prevState) {
      this.logAndEmit(key, nextState);
    }
  }

  private async getState(key: string): Promise<ECircuitBreaker> {
    const state = await this.redis.get(KEYS.CIRCUIT_BREAKER_STATE(key));
    return (state as ECircuitBreaker | null) ?? ECircuitBreaker.CLOSED;
  }

  private logAndEmit(key: string, state: ECircuitBreaker): void {
    this.logger.log(`Circuit "${key}" -> ${state}`);
    this.metrics.setBreakerState(key, state);
  }
}
