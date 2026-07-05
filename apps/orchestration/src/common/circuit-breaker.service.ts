import { Injectable, Logger } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import CircuitBreaker from 'opossum';
import { ORCHESTRATION_CONSTANTS, ORCHESTRATION_ERROR } from '@slack/constants';

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

  async run<T>(key: string, action: () => Promise<T>): Promise<T> {
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

    return (await breaker.fire(action)) as T;
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
      },
    );

    breaker.on('open', () =>
      this.logger.warn(
        `Circuit "${key}" OPEN — request mới fail nhanh trong ${ORCHESTRATION_CONSTANTS.CIRCUIT_BREAKER_RESET_TIMEOUT_MS / 1000}s`,
      ),
    );
    breaker.on('halfOpen', () =>
      this.logger.log(`Circuit "${key}" HALF_OPEN — thử lại 1 request`),
    );
    breaker.on('close', () =>
      this.logger.log(`Circuit "${key}" CLOSED — provider đã phục hồi`),
    );

    this.breakers.set(key, breaker);
    return breaker;
  }
}
