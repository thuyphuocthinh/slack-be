import { Injectable, Logger } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import CircuitBreaker from 'opossum';
import { ORCHESTRATION_CONSTANTS, ORCHESTRATION_ERROR } from '@slack/constants';
import { MetricsRegistryService } from './metrics-registry.service';

// Đánh dấu lỗi phát sinh do CHÍNH signal của lượt gọi này bị abort (user bấm
// Stop) — breaker dùng CHUNG cho mọi user theo key, nếu tính cả cancel là 1
// lỗi thật thì vài user bấm Stop cùng lúc có thể tự trip mạch, chặn nhầm
// user khác đang gọi bình thường.
const ABORTED_BY_CALLER = Symbol('circuit-breaker-aborted-by-caller');

interface TaggableError {
  [ABORTED_BY_CALLER]?: true;
}

/**
 * Giai đoạn 4, Step 6 — 1 breaker riêng cho mỗi `key` (VD `mcp:sql_server`,
 * `llm:gemini`), lazy tạo lần đầu gặp key đó. Cùng thư viện `opossum` đã dùng
 * ở `apps/socket-gateway/src/common/utils/circuit-breaker.util.ts`, viết lại
 * ở đây (không import chéo app) vì 2 app không chia sẻ lib chung cho việc này.
 *
 * `timeout: false` — đã có `withTimeout()` riêng ở từng call site
 * (LLM_CALL_TIMEOUT_MS/MCP_CALL_TIMEOUT_MS), breaker chỉ ĐẾM lỗi/mở mạch,
 * không tự canh giờ chồng lên timeout đã có.
 */
@Injectable()
export class CircuitBreakerService {
  private readonly logger = new Logger(CircuitBreakerService.name);
  private readonly breakers = new Map<
    string,
    CircuitBreaker<[() => Promise<unknown>], unknown>
  >();

  constructor(private readonly metrics: MetricsRegistryService) {}

  async run<T>(
    key: string,
    action: () => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    const breaker = this.getOrCreateBreaker(key);

    // Check TRƯỚC khi fire() (không phải bắt lỗi rồi mới suy ra) — chính xác
    // 100% đây là fail-fast do mạch đang mở, không lẫn với 1 lỗi thật vừa
    // khớp làm mạch mở ngay tại request đó.
    if (breaker.opened) {
      const message = `${ORCHESTRATION_ERROR.CIRCUIT_BREAKER_OPEN.message} (key=${key})`;
      this.logger.warn(`run() key=${key} bị chặn — circuit đang OPEN`);
      throw new RpcException({
        ...ORCHESTRATION_ERROR.CIRCUIT_BREAKER_OPEN,
        message,
      });
    }

    return (await breaker.fire(() => this.runTagged(action, signal))) as T;
  }

  // Gắn dấu lên lỗi NẾU signal của chính lượt gọi này đã abort — errorFilter
  // của breaker đọc dấu này để không tính vào thống kê lỗi. Gắn theo từng
  // lượt gọi (closure riêng), không phải state chung của breaker, nên nhiều
  // request cùng key chạy song song không giẫm lên nhau.
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

  // Backpressure/Admission control — trạng thái hiện tại của mọi breaker đã
  // từng tạo (key = 'mcp:<provider>'/'llm:<strategy>'), dùng cho health-check
  // và metrics — trước đây chỉ nằm trong log, không đọc được từ bên ngoài.
  getStates(): Record<string, 'open' | 'halfOpen' | 'closed'> {
    const states: Record<string, 'open' | 'halfOpen' | 'closed'> = {};
    this.breakers.forEach((breaker, key) => {
      states[key] = breaker.opened
        ? 'open'
        : breaker.halfOpen
          ? 'halfOpen'
          : 'closed';
    });
    return states;
  }

  private getOrCreateBreaker(
    key: string,
  ): CircuitBreaker<[() => Promise<unknown>], unknown> {
    const existing = this.breakers.get(key);
    if (existing) return existing;

    const breaker = new CircuitBreaker<[() => Promise<unknown>], unknown>(
      (fn) => fn(),
      {
        timeout: false,
        errorThresholdPercentage:
          ORCHESTRATION_CONSTANTS.CIRCUIT_BREAKER_ERROR_THRESHOLD_PERCENTAGE,
        volumeThreshold:
          ORCHESTRATION_CONSTANTS.CIRCUIT_BREAKER_VOLUME_THRESHOLD,
        resetTimeout: ORCHESTRATION_CONSTANTS.CIRCUIT_BREAKER_RESET_TIMEOUT_MS,
        errorFilter: (error: TaggableError) =>
          error?.[ABORTED_BY_CALLER] === true,
      },
    );

    breaker.on('open', () => {
      this.logger.warn(
        `Circuit "${key}" OPEN — request mới fail nhanh trong ${ORCHESTRATION_CONSTANTS.CIRCUIT_BREAKER_RESET_TIMEOUT_MS / 1000}s`,
      );
      this.metrics.setBreakerState(key, 'open');
    });
    breaker.on('halfOpen', () => {
      this.logger.log(`Circuit "${key}" HALF_OPEN — thử lại 1 request`);
      this.metrics.setBreakerState(key, 'halfOpen');
    });
    breaker.on('close', () => {
      this.logger.log(`Circuit "${key}" CLOSED — provider đã phục hồi`);
      this.metrics.setBreakerState(key, 'closed');
    });

    this.breakers.set(key, breaker);
    return breaker;
  }
}
