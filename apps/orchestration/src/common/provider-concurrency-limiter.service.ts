import { Injectable } from '@nestjs/common';

interface Waiter {
  resolve: () => void;
}

/**
 * Giai đoạn System, mục 5.2 — semaphore đơn giản theo `key` (VD `mcp:sql_server`),
 * độc lập với concurrency:5 (global) của BullMQ worker. Circuit breaker
 * (`CircuitBreakerService`) chỉ phản ứng SAU khi đã đủ lỗi (reactive); cái này
 * chặn TRƯỚC — nhiều user tình cờ dồn tải vào cùng 1 downstream service yếu
 * cũng không vượt quá `maxConcurrent` request đang chạy thật cùng lúc, phần
 * dư phải đợi tới lượt (FIFO), không bị fail ngay.
 */
@Injectable()
export class ProviderConcurrencyLimiterService {
  private readonly active = new Map<string, number>();
  private readonly waiting = new Map<string, Waiter[]>();

  async run<T>(
    key: string,
    maxConcurrent: number,
    action: () => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    await this.acquire(key, maxConcurrent, signal);
    try {
      return await action();
    } finally {
      this.release(key);
    }
  }

  private acquire(
    key: string,
    maxConcurrent: number,
    signal?: AbortSignal,
  ): Promise<void> {
    if (signal?.aborted) {
      return Promise.reject(new Error('Aborted'));
    }

    const current = this.active.get(key) ?? 0;
    if (current < maxConcurrent) {
      this.active.set(key, current + 1);
      return Promise.resolve();
    }

    return new Promise<void>((resolve, reject) => {
      const queue = this.waiting.get(key) ?? [];

      const resolveWrapper = () => {
        if (signal) {
          signal.removeEventListener('abort', onAbort);
        }
        resolve();
      };

      const onAbort = () => {
        const q = this.waiting.get(key);
        if (q) {
          const idx = q.findIndex((w) => w.resolve === resolveWrapper);
          if (idx !== -1) {
            q.splice(idx, 1);
          }
          if (q.length === 0) {
            this.waiting.delete(key);
          } else {
            this.waiting.set(key, q);
          }
        }
        reject(new Error('Aborted'));
      };

      if (signal) {
        signal.addEventListener('abort', onAbort);
      }

      queue.push({ resolve: resolveWrapper });
      this.waiting.set(key, queue);
    });
  }

  // Chuyển slot trực tiếp cho waiter kế tiếp (không giảm rồi tăng lại active)
  // — tránh 1 request khác chen ngang cướp slot vừa trống giữa 2 bước đó.
  private release(key: string): void {
    const queue = this.waiting.get(key);
    if (queue?.length) {
      const next = queue.shift()!;
      next.resolve();
      return;
    }

    const current = (this.active.get(key) ?? 1) - 1;
    if (current <= 0) this.active.delete(key);
    else this.active.set(key, current);
  }
}
