import CircuitBreaker from 'opossum';
import { Logger } from '@nestjs/common';

export interface BreakerOptions extends CircuitBreaker.Options {
  name: string;
}

export function createBreaker<T, R>(
  action: (...args: T[]) => Promise<R>,
  options: BreakerOptions,
) {
  const logger = new Logger(`CircuitBreaker:${options.name}`);

  const breaker = new CircuitBreaker(action, {
    timeout: options.timeout || 3000, // Đợi 3s
    errorThresholdPercentage: options.errorThresholdPercentage || 50, // Lỗi 50% thì ngắt
    resetTimeout: options.resetTimeout || 30000, // Sau 30s thử lại
    ...options,
  });

  breaker.on('open', () => {
    logger.warn(`Circuit for ${options.name} is OPEN (Ngắt mạch)`);
  });

  breaker.on('halfOpen', () => {
    logger.log(`Circuit for ${options.name} is HALF_OPEN (Đang thử lại)`);
  });

  breaker.on('close', () => {
    logger.log(`Circuit for ${options.name} is CLOSED (Mạch đã đóng)`);
  });

  breaker.on('fallback', (result) => {
    logger.warn(`Circuit for ${options.name} is using FALLBACK`);
    return result;
  });

  return breaker;
}
