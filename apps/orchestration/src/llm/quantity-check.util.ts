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
  const generate = <T>(
    systemInstruction: string,
    prompt: string,
    schema: Record<string, unknown>,
  ) =>
    circuitBreaker.run(`llm:${strategy.id}`, () =>
      withLlmRetry(
        () =>
          strategy.generateStructured<T>({
            model,
            systemInstruction,
            prompt,
            schema,
            signal,
          }),
        ORCHESTRATION_CONSTANTS.LLM_CALL_TIMEOUT_MS,
        `checkQuantity() timeout sau ${ORCHESTRATION_CONSTANTS.LLM_CALL_TIMEOUT_MS / 1000}s`,
        { signal },
      ),
    );

  try {
    const required = await generate<QuantityCheckRequiredDto>(
      QUANTITY_CHECK_REQUIRED_PROMPT,
      task,
      QUANTITY_CHECK_REQUIRED_SCHEMA,
    );
    if (required.requiredCount <= 0) {
      return { requiredCount: 0, achievedCount: 0 };
    }

    const achieved = await generate<QuantityCheckAchievedDto>(
      QUANTITY_CHECK_ACHIEVED_PROMPT,
      resultsText,
      QUANTITY_CHECK_ACHIEVED_SCHEMA,
    );
    return {
      requiredCount: required.requiredCount,
      achievedCount: achieved.achievedCount,
    };
  } catch (error) {
    logger.warn(`checkQuantity() failed: ${(error as Error).message}`);
    return { requiredCount: 0, achievedCount: 0 };
  }
}
