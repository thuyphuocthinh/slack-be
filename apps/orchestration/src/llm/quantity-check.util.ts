import { Logger } from '@nestjs/common';
import {
  ORCHESTRATION_CONSTANTS,
  QUANTITY_CHECK_ACHIEVED_PROMPT,
  QUANTITY_CHECK_ACHIEVED_SCHEMA,
  QUANTITY_CHECK_REQUIRED_PROMPT,
  QUANTITY_CHECK_REQUIRED_SCHEMA,
} from '@slack/constants';
import {
  QuantityCheckAchievedDto,
  QuantityCheckRequiredDto,
} from '../dto/react-loop.dto';
import { CircuitBreakerService } from '../common/circuit-breaker.service';
import { LlmStrategy } from './strategy/llm-strategy.interface';
import { withLlmRetry } from './with-llm-retry.util';

export interface QuantityCheckResult {
  requiredCount: number;
  achievedCount: number;
}

function generate<T>(
  strategy: LlmStrategy,
  model: string,
  circuitBreaker: CircuitBreakerService,
  systemInstruction: string,
  prompt: string,
  schema: Record<string, unknown>,
  signal: AbortSignal | undefined,
  timeoutLabel: string,
): Promise<T> {
  return circuitBreaker.run(`llm:${strategy.id}`, () =>
    withLlmRetry(
      (attemptSignal) =>
        strategy.generateStructured<T>({
          model,
          systemInstruction,
          prompt,
          schema,
          signal: attemptSignal,
        }),
      ORCHESTRATION_CONSTANTS.LLM_CALL_TIMEOUT_MS,
      `${timeoutLabel} timeout sau ${ORCHESTRATION_CONSTANTS.LLM_CALL_TIMEOUT_MS / 1000}s`,
      { signal },
    ),
  );
}

/** Tách riêng khỏi checkQuantity() để dùng được TRƯỚC KHI có kết quả tool
 * (VD chặn 1 tool ghi trước approval gate) mà không tốn thêm 1 LLM call
 * "achieved" không cần thiết ở thời điểm đó. */
export async function extractRequiredCount(
  task: string,
  strategy: LlmStrategy,
  model: string,
  circuitBreaker: CircuitBreakerService,
  logger: Logger,
  signal?: AbortSignal,
): Promise<number> {
  try {
    const required = await generate<QuantityCheckRequiredDto>(
      strategy,
      model,
      circuitBreaker,
      QUANTITY_CHECK_REQUIRED_PROMPT,
      task,
      QUANTITY_CHECK_REQUIRED_SCHEMA,
      signal,
      'extractRequiredCount()',
    );
    return Math.max(required.requiredCount, 0);
  } catch (error) {
    logger.warn(`extractRequiredCount() failed: ${(error as Error).message}`);
    return 0;
  }
}

/** ver3.md mục 3 — required/achieved trích xuất bằng LLM, so khớp bằng code. */
export async function checkQuantity(
  task: string,
  resultsText: string,
  strategy: LlmStrategy,
  model: string,
  circuitBreaker: CircuitBreakerService,
  logger: Logger,
  signal?: AbortSignal,
): Promise<QuantityCheckResult> {
  const requiredCount = await extractRequiredCount(
    task,
    strategy,
    model,
    circuitBreaker,
    logger,
    signal,
  );
  if (requiredCount <= 0) {
    return { requiredCount: 0, achievedCount: 0 };
  }

  try {
    const achieved = await generate<QuantityCheckAchievedDto>(
      strategy,
      model,
      circuitBreaker,
      QUANTITY_CHECK_ACHIEVED_PROMPT,
      resultsText,
      QUANTITY_CHECK_ACHIEVED_SCHEMA,
      signal,
      'checkQuantity()',
    );
    return { requiredCount, achievedCount: achieved.achievedCount };
  } catch (error) {
    logger.warn(`checkQuantity() failed: ${(error as Error).message}`);
    return { requiredCount: 0, achievedCount: 0 };
  }
}
