import { Injectable, Logger } from '@nestjs/common';
import { ORCHESTRATION_CONSTANTS } from '@slack/constants';
import { DelegationDto } from '../dto/supervisor.dto';
import { CheckpointResponseDto } from '../dto/checkpoint.dto';
import { checkQuantity } from '../llm/quantity-check.util';
import { LlmStrategyFactory } from '../llm/strategy/llm-strategy.factory';
import { CircuitBreakerService } from '../common/circuit-breaker.service';

@Injectable()
export class ApprovalContinuationPlannerService {
  private readonly logger = new Logger(ApprovalContinuationPlannerService.name);

  constructor(
    private readonly llmFactory: LlmStrategyFactory,
    private readonly circuitBreaker: CircuitBreakerService,
  ) { }

  async resolveRemainingSteps(
    checkpoint: CheckpointResponseDto,
    toolResultText: string,
  ): Promise<{
    remainingSteps: DelegationDto[] | undefined;
    resultText: string;
  }> {
    const { pendingTool, pendingTask, roundsSoFar, remainingSteps } =
      checkpoint;
    const rootTask = (task: string) => task.split('\n\n(Đã xử lý')[0];
    const attempts =
      roundsSoFar.filter(
        (r) =>
          r.agent === pendingTool!.provider &&
          rootTask(r.task) === rootTask(pendingTask),
      ).length + 1;
    const capReached =
      attempts >= ORCHESTRATION_CONSTANTS.MAX_QUANTITY_CONTINUATION_ROUNDS;

    const { strategy, model } = this.llmFactory.resolve(
      process.env.DEFAULT_REACT_MODEL ??
      ORCHESTRATION_CONSTANTS.DEFAULT_REACT_MODEL,
    );
    const { requiredCount, achievedCount } = await checkQuantity(
      pendingTask,
      toolResultText,
      strategy,
      model,
      this.circuitBreaker,
      this.logger,
    );
    if (requiredCount === 0 || requiredCount === achievedCount) {
      return { remainingSteps, resultText: toolResultText };
    }

    if (capReached) {
      this.logger.warn(
        `checkpoint=${checkpoint.id} quantity vẫn thiếu (requiredCount=${requiredCount} achievedCount=${achievedCount}) sau ${attempts} lần thử — dừng lại, báo rõ cho user`,
      );
      return {
        remainingSteps,
        resultText: `${toolResultText}\n\n[Lưu ý: yêu cầu cần ${requiredCount}, mới xử lý được ${achievedCount} sau ${attempts} lần thử — đã dừng lại, KHÔNG tự động thử thêm.]`,
      };
    }

    this.logger.log(
      `checkpoint=${checkpoint.id} quantity mismatch requiredCount=${requiredCount} achievedCount=${achievedCount} — nudging to continue`,
    );
    const continuationStep: DelegationDto = {
      agent: pendingTool!.provider,
      task: `${pendingTask}\n\n(Đã xử lý ${achievedCount}/${requiredCount} — làm tiếp ${requiredCount - achievedCount} phần còn thiếu, không lặp lại phần đã xong. Nếu tool cho phép nhiều bản ghi trong 1 lần gọi, hãy gộp TOÀN BỘ ${requiredCount - achievedCount} phần còn thiếu vào ĐÚNG 1 lần gọi tool duy nhất — mỗi lần cần duyệt lại tốn thêm 1 vòng chờ user, không chia nhỏ thêm nữa.)`,
      mustExecute: true,
    };
    return {
      remainingSteps: [continuationStep, ...(remainingSteps ?? [])],
      resultText: toolResultText,
    };
  }
}
