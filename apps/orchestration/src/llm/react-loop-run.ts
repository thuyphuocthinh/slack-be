import { Logger } from '@nestjs/common';
import {
  ORCHESTRATION_CONSTANTS,
  ORCHESTRATION_SELF_CHECK_PROMPT,
} from '@slack/constants';
import { McpClientService } from '../mcp/mcp-client.service';
import {
  RunReactLoopRequestDto,
  RunReactLoopResponseDto,
} from '../dto/react-loop.dto';
import { checkQuantity as checkQuantityUtil } from './quantity-check.util';
import {
  LlmChatSession,
  LlmStrategy,
  LlmToolResult,
  LlmTurnResult,
} from './strategy/llm-strategy.interface';
import { AgentStreamService } from '../socket/agent-stream.service';
import { withLlmRetry } from './with-llm-retry.util';
import { CircuitBreakerService } from '../common/circuit-breaker.service';
import { McpToolDto } from '../dto/mcp.dto';
import { MemoryManagerService } from '../memory/memory-manager.service';
import { ToolRepeatGuard } from './tool-repeat-guard';
import { InsertAccumulator } from './insert-accumulator';
import { ToolRiskGate } from './tool-risk-gate';
import { ToolCallExecutor } from './tool-call-executor';

export interface ReactLoopRunOptions {
  dto: RunReactLoopRequestDto;
  mcpTools: McpToolDto[];
  strategy: LlmStrategy;
  model: string;
  reactModelId: string;
  session: LlmChatSession;
  signal: AbortSignal;
  // Không truyền (VD test cũ) → tự tạo guard riêng cho đúng behavior cũ.
  repeatGuard?: ToolRepeatGuard;
}

export interface ReactLoopRunDeps {
  mcpClient: McpClientService;
  agentStream: AgentStreamService;
  circuitBreaker: CircuitBreakerService;
  memoryManager: MemoryManagerService;
  logger: Logger;
}

/**
 * Điều khiển vòng lặp ReAct (1 agent, 1 lượt): gọi LLM, chuyển tool call cho
 * ToolCallExecutor, chạy self-check/quantity-nudge khi model dừng gọi tool.
 * Risk-gate (destructive/auto-approve) nằm ở ToolRiskGate, cơ chế thực thi
 * tool (dedup/retry/trace) nằm ở ToolCallExecutor — tách ra để mỗi phần có 1
 * lý do thay đổi riêng, dễ test trực tiếp hơn suy luận qua mock. Xem thiết kế
 * đầy đủ (WHY): slack-docs/Documents/Orchestration/code-notes/react-loop.service.md
 */
export class ReactLoopRun {
  private readonly dto: RunReactLoopRequestDto;
  private readonly strategy: LlmStrategy;
  private readonly model: string;
  private readonly session: LlmChatSession;
  private readonly signal: AbortSignal;

  private readonly circuitBreaker: CircuitBreakerService;
  private readonly logger: Logger;

  private readonly toolExecutor: ToolCallExecutor;

  constructor(options: ReactLoopRunOptions, deps: ReactLoopRunDeps) {
    this.dto = options.dto;
    this.strategy = options.strategy;
    this.model = options.model;
    this.session = options.session;
    this.signal = options.signal;

    this.circuitBreaker = deps.circuitBreaker;
    this.logger = deps.logger;

    const insertAccumulator = new InsertAccumulator();
    const riskGate = new ToolRiskGate({
      dto: options.dto,
      mcpTools: options.mcpTools,
      strategy: options.strategy,
      model: options.model,
      circuitBreaker: deps.circuitBreaker,
      logger: deps.logger,
      signal: options.signal,
      insertAccumulator,
    });
    this.toolExecutor = new ToolCallExecutor(
      {
        dto: options.dto,
        mcpTools: options.mcpTools,
        reactModelId: options.reactModelId,
        signal: options.signal,
      },
      {
        mcpClient: deps.mcpClient,
        agentStream: deps.agentStream,
        memoryManager: deps.memoryManager,
        logger: deps.logger,
        repeatGuard: options.repeatGuard ?? new ToolRepeatGuard(),
        insertAccumulator,
        riskGate,
      },
    );
  }

  async execute(
    onToken: (chunk: string) => void,
    resync: (text: string) => void,
  ): Promise<RunReactLoopResponseDto> {
    let turn = await this.sendMessage(this.dto.prompt, onToken);
    let selfChecked = false;

    for (let step = 0; step < ORCHESTRATION_CONSTANTS.MAX_REACT_STEPS; step++) {
      if (turn.toolCalls.length === 0) {
        const outcome = await this.handleNoMoreToolCalls(
          turn,
          step,
          selfChecked,
          onToken,
          resync,
        );
        if (!outcome.done) {
          selfChecked = true;
          turn = outcome.nextTurn;
          continue;
        }
        return outcome.response;
      }

      resync('');

      const results = await this.toolExecutor.run(turn.toolCalls);

      turn = await this.sendMessage(results, onToken);
    }

    return this.buildMaxStepsResponse(turn);
  }

  /** Model vừa dừng gọi tool — chạy self-check/quantity-nudge (tối đa 1 lần),
   * hoặc chốt câu trả lời nếu đã tự kiểm tra rồi. */
  private async handleNoMoreToolCalls(
    turn: LlmTurnResult,
    step: number,
    selfChecked: boolean,
    onToken: (chunk: string) => void,
    resync: (text: string) => void,
  ): Promise<
    | { done: true; response: RunReactLoopResponseDto }
    | { done: false; nextTurn: LlmTurnResult }
  > {
    const toolCalls = this.toolExecutor.getToolCalls();
    // Cần chừa 1 bước để xử lý tool call do nudge sinh ra, không thì mất luôn.
    const hasBudgetForSelfCheck =
      step < ORCHESTRATION_CONSTANTS.MAX_REACT_STEPS - 1;
    if (selfChecked || toolCalls.length === 0 || !hasBudgetForSelfCheck) {
      this.logger.log(
        `run() done at step=${step} toolCalls=${toolCalls.length}`,
      );
      return {
        done: true,
        response: {
          answer: turn.text || 'Xin lỗi, mình chưa có câu trả lời phù hợp.',
          toolCalls,
        },
      };
    }

    const answerBeforeSelfCheck = turn.text;
    const { requiredCount, achievedCount } = await this.checkQuantity();
    if (requiredCount > 0 && requiredCount !== achievedCount) {
      this.logger.log(
        `quantity mismatch requiredCount=${requiredCount} achievedCount=${achievedCount} — nudging to continue`,
      );
      const nudgeTurn = await this.sendMessage(
        `Yêu cầu cần xử lý đúng ${requiredCount} bản ghi, nhưng theo kết quả tool hiện tại mới có ${achievedCount}. Hãy tiếp tục thực hiện phần còn thiếu trước khi trả lời.`,
        onToken,
      );
      if (nudgeTurn.toolCalls.length > 0) {
        resync('');
        return { done: false, nextTurn: nudgeTurn };
      }
      this.logger.warn(
        `run() done at step=${step} toolCalls=${toolCalls.length} (quantity vẫn thiếu nhưng model không gọi thêm tool) requiredCount=${requiredCount} achievedCount=${achievedCount}`,
      );
      // Bug thật (HH1) — model từng báo "đã xong đủ N" dù achievedCount thật
      // KHÁC N (bịa số/lặp lại số đã yêu cầu). KHÔNG tin nguyên văn câu trả lời
      // của model ở nhánh này — luôn tự chèn CON SỐ THẬT đã tính được, để user
      // không bị đọc nhầm là đã xong đủ.
      const baseAnswer =
        answerBeforeSelfCheck || 'Xin lỗi, mình chưa có câu trả lời phù hợp.';
      const answer = `${baseAnswer}\n\n⚠️ Yêu cầu cần xử lý đúng ${requiredCount}, nhưng theo kết quả tool THẬT chỉ xác nhận được ${achievedCount}.`;
      resync(answer);
      return { done: true, response: { answer, toolCalls } };
    }

    this.logger.log('self-check nudge triggered');
    const selfCheckTurn = await this.sendMessage(
      ORCHESTRATION_SELF_CHECK_PROMPT,
      onToken,
    );
    if (selfCheckTurn.toolCalls.length > 0) {
      resync('');
      return { done: false, nextTurn: selfCheckTurn };
    }
    this.logger.log(
      `run() done at step=${step} toolCalls=${toolCalls.length} (giữ câu trả lời TRƯỚC self-check)`,
    );
    const answer =
      answerBeforeSelfCheck || 'Xin lỗi, mình chưa có câu trả lời phù hợp.';
    resync(answer);
    return { done: true, response: { answer, toolCalls } };
  }

  private buildMaxStepsResponse(turn: LlmTurnResult): RunReactLoopResponseDto {
    this.logger.warn(
      `run() hit MAX_REACT_STEPS=${ORCHESTRATION_CONSTANTS.MAX_REACT_STEPS} userId=${this.dto.userId}`,
    );
    const partialWriteCaveat = this.toolExecutor.hasAnySuccessfulToolCall()
      ? ' Một số hành động (đọc/ghi dữ liệu) đã thực hiện THÀNH CÔNG trước khi dừng — kiểm tra lại kết quả hiện có trước khi yêu cầu lại, tránh lặp lại đúng thao tác đã làm.'
      : '';
    return {
      answer:
        (turn.text ||
          'Xin lỗi, câu hỏi này cần nhiều bước hơn mình hỗ trợ được.') +
        partialWriteCaveat,
      toolCalls: this.toolExecutor.getToolCalls(),
    };
  }

  // streamedAnything reset lại MỖI lần thử (đầu fn()) — chỉ cho retry khi lần
  // vừa lỗi CHƯA stream ra token nào (xem
  // ORCHESTRATION_CONSTANTS.MAX_LLM_CALL_RETRY_ATTEMPTS).
  private sendMessage(
    input: string | LlmToolResult[],
    onTok?: (chunk: string) => void,
  ): Promise<LlmTurnResult> {
    let streamedAnything = false;
    const trackedOnTok = onTok
      ? (chunk: string) => {
          streamedAnything = true;
          onTok(chunk);
        }
      : undefined;
    return this.circuitBreaker.run(
      `llm:${this.strategy.id}`,
      () =>
        withLlmRetry(
          (attemptSignal) => {
            streamedAnything = false;
            return this.session.sendMessage(input, trackedOnTok, attemptSignal);
          },
          ORCHESTRATION_CONSTANTS.LLM_CALL_TIMEOUT_MS,
          `ReactLoop sendMessage() timeout sau ${ORCHESTRATION_CONSTANTS.LLM_CALL_TIMEOUT_MS / 1000}s (provider=${this.dto.provider}, model=${this.model})`,
          { signal: this.signal, canRetry: () => !streamedAnything },
        ),
      this.signal,
    );
  }

  private checkQuantity() {
    return checkQuantityUtil(
      this.dto.prompt,
      this.toolExecutor
        .getToolCalls()
        .map((tc) => `${tc.tool}: ${tc.resultPreview ?? ''}`)
        .join('\n'),
      this.strategy,
      this.model,
      this.circuitBreaker,
      this.logger,
      this.signal,
    );
  }
}
