import { Logger } from '@nestjs/common';
import { traceable } from 'langsmith/traceable';
import {
  ORCHESTRATION_CONSTANTS,
  ORCHESTRATION_SELF_CHECK_PROMPT,
  EStepExecutionStatus,
} from '@slack/constants';
import { extractTextFromMcpResult } from '@slack/common';
import { McpClientService } from '../mcp/mcp-client.service';
import {
  RunReactLoopRequestDto,
  RunReactLoopResponseDto,
  ToolCallTraceDto,
} from '../dto/react-loop.dto';
import {
  checkQuantity as checkQuantityUtil,
  extractRequiredCount,
} from './quantity-check.util';
import {
  LlmChatSession,
  LlmStrategy,
  LlmToolCall,
  LlmToolResult,
  LlmTurnResult,
} from './strategy/llm-strategy.interface';
import { AgentStreamService } from '../socket/agent-stream.service';
import { withLlmRetry } from './with-llm-retry.util';
import { ApprovalRequiredError } from './approval-required.error';
import { CircuitBreakerService } from '../common/circuit-breaker.service';
import { CallToolResponseDto, McpToolDto } from '../dto/mcp.dto';
import { abortableSleep } from '../common/abortable-sleep.util';
import { capToolResultSize } from '../executor/tool-result-size-cap.util';
import { classifyToolError } from '../executor/tool-error-classifier.util';
import { parseInsertValues } from '../executor/parse-insert-values.util';
import { isLikelyCreateToolCall } from '../memory/create-tool-heuristic.util';
import { MemoryManagerService } from '../memory/memory-manager.service';
import { extractWriteQueryPreviewTarget } from './write-query-preview.util';

/** Gộp về 1 dòng, không cắt bớt — xem code-notes/react-loop.service.md */
function formatResultPreview(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** Xem code-notes/react-loop.service.md */
function formatArgsPreview(args: Record<string, unknown>): string {
  const values = Object.values(args);
  if (values.length === 1 && typeof values[0] === 'string') {
    return values[0];
  }
  return JSON.stringify(args, null, 2);
}

export interface ReactLoopRunOptions {
  dto: RunReactLoopRequestDto;
  mcpTools: McpToolDto[];
  strategy: LlmStrategy;
  model: string;
  reactModelId: string;
  session: LlmChatSession;
  signal: AbortSignal;
}

export interface ReactLoopRunDeps {
  mcpClient: McpClientService;
  agentStream: AgentStreamService;
  circuitBreaker: CircuitBreakerService;
  memoryManager: MemoryManagerService;
  logger: Logger;
}

/**
 * State + logic của 1 lần chạy react-loop (1 agent, 1 lượt). Tách khỏi
 * ReactLoopService để mỗi state (cache tool call, required count...) là 1
 * field riêng thay vì phải truyền qua hàng loạt tham số. Xem thiết kế đầy đủ
 * (WHY): slack-docs/Documents/Orchestration/code-notes/react-loop.service.md
 */
export class ReactLoopRun {
  private readonly dto: RunReactLoopRequestDto;
  private readonly mcpTools: McpToolDto[];
  private readonly strategy: LlmStrategy;
  private readonly model: string;
  private readonly reactModelId: string;
  private readonly session: LlmChatSession;
  private readonly signal: AbortSignal;

  private readonly mcpClient: McpClientService;
  private readonly agentStream: AgentStreamService;
  private readonly circuitBreaker: CircuitBreakerService;
  private readonly memoryManager: MemoryManagerService;
  private readonly logger: Logger;

  private readonly toolCalls: ToolCallTraceDto[] = [];
  private readonly callSignatureCounts = new Map<string, number>();
  private readonly successfulCallCache = new Map<
    string,
    { resultPreview: string; feedText: string }
  >();
  // Lazy + memoized — chỉ tốn 1 LLM call DUY NHẤT cho cả lượt chạy, và chỉ
  // khi thật sự cần (tool ghi dạng create bị chặn approval), không tốn cho
  // các round chỉ đọc dữ liệu.
  private requiredCountPromise: Promise<number> | null = null;

  // Tích luỹ tuple INSERT qua nhiều lần gọi (khoá theo table+cột) — xem checkBulkInsertShortfall().
  private readonly insertAccumulator = new Map<
    string,
    { insertPrefix: string; tuples: Set<string> }
  >();

  // handleToolCall() bind + traceable() 1 LẦN ở constructor — gọi trực tiếp
  // this.handleToolCall(...) trong execute() sẽ KHÔNG lên trace LangSmith.
  private readonly tracedHandleToolCall: (
    name: string,
    args: Record<string, unknown>,
  ) => Promise<string>;

  constructor(options: ReactLoopRunOptions, deps: ReactLoopRunDeps) {
    this.dto = options.dto;
    this.mcpTools = options.mcpTools;
    this.strategy = options.strategy;
    this.model = options.model;
    this.reactModelId = options.reactModelId;
    this.session = options.session;
    this.signal = options.signal;

    this.mcpClient = deps.mcpClient;
    this.agentStream = deps.agentStream;
    this.circuitBreaker = deps.circuitBreaker;
    this.memoryManager = deps.memoryManager;
    this.logger = deps.logger;

    this.tracedHandleToolCall = traceable(
      (name: string, args: Record<string, unknown>) =>
        this.handleToolCall(name, args),
      { name: 'mcp.callTool' },
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

      const results = await this.resolveToolCalls(turn.toolCalls);

      turn = await this.sendMessage(results, onToken);
    }

    return this.buildMaxStepsResponse(turn);
  }

  // Tool call trong CÙNG 1 lượt chạy song song (tốc độ), nhưng 2 rủi ro cần
  // xếp hàng riêng thay vì chạy đồng thời: (1) 2 call TRÙNG hệt nhau (tên+
  // tham số) — vẫn gọi qua tracedHandleToolCall() bình thường để đúng cơ chế
  // repeat-guard/cache có sẵn (attempts/successfulCallCache) tự nhận ra và
  // trả kết quả cache cho lần lặp, chỉ là lần lặp phải ĐỢI lần đầu xong hẳn
  // mới bắt đầu, không cho cả 2 cùng lọt qua bookkeeping một lúc; (2) 2
  // INSERT nhắm CÙNG bảng — checkBulkInsertShortfall() gộp tuple qua 1 Map
  // dùng chung (insertAccumulator), chạy đồng thời có thể làm 1 call thấy số
  // liệu đã lỗi thời của call kia. Khác chữ ký/khác bảng vẫn chạy song song
  // thật.
  private resolveToolCalls(toolCalls: LlmToolCall[]): Promise<LlmToolResult[]> {
    const lastRunBySignature = new Map<string, Promise<unknown>>();
    const lastRunByTable = new Map<string, Promise<unknown>>();

    const runs = toolCalls.map((call) => {
      const signature = `${call.name}:${JSON.stringify(call.args)}`;
      const tableKey = this.resolveInsertTableKey(call);
      const waitFor = [
        lastRunBySignature.get(signature),
        tableKey ? lastRunByTable.get(tableKey) : undefined,
      ].filter((p): p is Promise<unknown> => !!p);

      const run = waitFor.length
        ? Promise.allSettled(waitFor).then(() =>
            this.tracedHandleToolCall(call.name, call.args),
          )
        : this.tracedHandleToolCall(call.name, call.args);

      lastRunBySignature.set(signature, run);
      if (tableKey) lastRunByTable.set(tableKey, run);
      return run;
    });

    return Promise.all(
      runs.map(async (run, i) => ({
        id: toolCalls[i].id,
        name: toolCalls[i].name,
        content: (await run) as string,
      })),
    );
  }

  private resolveInsertTableKey(call: LlmToolCall): string | null {
    if (
      this.dto.provider !== 'sql_server' ||
      call.name !== 'execute_write_query'
    ) {
      return null;
    }
    const query =
      typeof call.args.query === 'string' ? call.args.query : undefined;
    if (!query) return null;
    return parseInsertValues(query)?.tableSignature ?? null;
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
    // Cần chừa 1 bước để xử lý tool call do nudge sinh ra, không thì mất luôn.
    const hasBudgetForSelfCheck =
      step < ORCHESTRATION_CONSTANTS.MAX_REACT_STEPS - 1;
    if (selfChecked || this.toolCalls.length === 0 || !hasBudgetForSelfCheck) {
      this.logger.log(
        `run() done at step=${step} toolCalls=${this.toolCalls.length}`,
      );
      return {
        done: true,
        response: {
          answer: turn.text || 'Xin lỗi, mình chưa có câu trả lời phù hợp.',
          toolCalls: this.toolCalls,
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
      this.logger.log(
        `run() done at step=${step} toolCalls=${this.toolCalls.length} (quantity vẫn thiếu nhưng model không gọi thêm tool)`,
      );
      const answer =
        answerBeforeSelfCheck || 'Xin lỗi, mình chưa có câu trả lời phù hợp.';
      resync(answer);
      return { done: true, response: { answer, toolCalls: this.toolCalls } };
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
      `run() done at step=${step} toolCalls=${this.toolCalls.length} (giữ câu trả lời TRƯỚC self-check)`,
    );
    const answer =
      answerBeforeSelfCheck || 'Xin lỗi, mình chưa có câu trả lời phù hợp.';
    resync(answer);
    return { done: true, response: { answer, toolCalls: this.toolCalls } };
  }

  private buildMaxStepsResponse(turn: LlmTurnResult): RunReactLoopResponseDto {
    this.logger.warn(
      `run() hit MAX_REACT_STEPS=${ORCHESTRATION_CONSTANTS.MAX_REACT_STEPS} userId=${this.dto.userId}`,
    );
    const partialWriteCaveat = this.toolCalls.some(
      (tc) => tc.status === 'success',
    )
      ? ' Một số hành động (đọc/ghi dữ liệu) đã thực hiện THÀNH CÔNG trước khi dừng — kiểm tra lại kết quả hiện có trước khi yêu cầu lại, tránh lặp lại đúng thao tác đã làm.'
      : '';
    return {
      answer:
        (turn.text ||
          'Xin lỗi, câu hỏi này cần nhiều bước hơn mình hỗ trợ được.') +
        partialWriteCaveat,
      toolCalls: this.toolCalls,
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
      this.toolCalls
        .map((tc) => `${tc.tool}: ${tc.resultPreview ?? ''}`)
        .join('\n'),
      this.strategy,
      this.model,
      this.circuitBreaker,
      this.logger,
      this.signal,
    );
  }

  private getRequiredCount(): Promise<number> {
    if (!this.requiredCountPromise) {
      this.requiredCountPromise = extractRequiredCount(
        this.dto.prompt,
        this.strategy,
        this.model,
        this.circuitBreaker,
        this.logger,
        this.signal,
      );
    }
    return this.requiredCountPromise;
  }

  // Dedupe theo text tuple — phòng model gửi lại y hệt dòng đã gửi ở lần trước.
  private accumulateInsertTuples(parsed: {
    insertPrefix: string;
    tableSignature: string;
    tuples: string[];
  }): { insertPrefix: string; tuples: string[] } {
    const entry = this.insertAccumulator.get(parsed.tableSignature) ?? {
      insertPrefix: parsed.insertPrefix,
      tuples: new Set<string>(),
    };
    parsed.tuples.forEach((t) => entry.tuples.add(t));
    this.insertAccumulator.set(parsed.tableSignature, entry);
    return {
      insertPrefix: entry.insertPrefix,
      tuples: Array.from(entry.tuples),
    };
  }

  // Model ghi thiếu dòng so với yêu cầu, kể cả rải ra nhiều lần gọi 1-dòng-1-lần —
  // gộp tuple tích luỹ được thành 1 câu INSERT duy nhất, ghi đè args.query.
  private async checkBulkInsertShortfall(
    displayName: string,
    argsPreview: string,
    args: Record<string, unknown>,
  ): Promise<string | null> {
    const query = typeof args.query === 'string' ? args.query : undefined;
    if (!query || !isLikelyCreateToolCall({ tool: displayName, argsPreview })) {
      return null;
    }
    const requiredCount = await this.getRequiredCount();
    if (requiredCount <= 0) return null;
    const parsed = parseInsertValues(query);
    if (!parsed) return null;

    const { insertPrefix, tuples } = this.accumulateInsertTuples(parsed);
    if (tuples.length >= requiredCount) {
      args.query = `${insertPrefix} ${tuples.join(', ')}`;
      return null;
    }
    return `Đã ghi nhận ${tuples.length}/${requiredCount} dòng yêu cầu (cộng dồn qua các lần gọi trước nếu có). Viết tiếp các dòng CÒN THIẾU (không lặp lại dòng đã gửi) trong 1 câu ghi duy nhất, rồi gọi lại.`;
  }

  private clearInsertAccumulator(query: string): void {
    const tableSignature = parseInsertValues(query)?.tableSignature;
    if (tableSignature) this.insertAccumulator.delete(tableSignature);
  }

  private async handleToolCall(
    name: string,
    args: Record<string, unknown>,
  ): Promise<string> {
    const displayName = `${this.dto.provider}.${name}`;
    const argsPreview = formatArgsPreview(args);

    if (
      this.mcpTools.find((t) => t.name === name)?.annotations?.destructiveHint
    ) {
      return this.handleDestructiveToolCall(
        name,
        args,
        displayName,
        argsPreview,
      );
    }

    return this.executeTrackedToolCall(name, args, displayName, argsPreview);
  }

  private async executeTrackedToolCall(
    name: string,
    args: Record<string, unknown>,
    displayName: string,
    argsPreview: string,
  ): Promise<string> {
    const signature = `${name}:${JSON.stringify(args)}`;
    const attempts = (this.callSignatureCounts.get(signature) ?? 0) + 1;
    this.callSignatureCounts.set(signature, attempts);

    if (attempts > 1) {
      const cached = this.successfulCallCache.get(signature);
      if (cached) {
        return this.reuseCachedCall(displayName, argsPreview, attempts, cached);
      }
    }

    if (attempts > ORCHESTRATION_CONSTANTS.MAX_SAME_TOOL_CALL_REPEATS) {
      return this.blockRepeatedCall(name, displayName, argsPreview, attempts);
    }

    return this.runToolCall(name, args, displayName, argsPreview, signature);
  }

  // INSERT không đụng tới dữ liệu CŨ — sai thì chỉ cần xoá dòng vừa thêm,
  // khác hẳn UPDATE/DELETE (có thể ghi đè/xoá mất dữ liệu không khôi phục
  // được). Chỉ tự chạy đúng trường hợp này, mọi câu lệnh ghi khác vẫn qua
  // Risk Gate như cũ.
  private isAutoApprovableInsert(
    name: string,
    args: Record<string, unknown>,
  ): boolean {
    if (this.dto.provider !== 'sql_server' || name !== 'execute_write_query') {
      return false;
    }
    const query = typeof args.query === 'string' ? args.query : undefined;
    if (!query) return false;
    return extractWriteQueryPreviewTarget(query)?.kind === 'insert-rows';
  }

  /** Risk Gate (Giai đoạn 3, HITL) — chặn TRƯỚC KHI thực thi, trừ khi model
   * ghi thiếu dòng so với yêu cầu (nhắc sửa lại thay vì đẩy lên duyệt ngay). */
  private async handleDestructiveToolCall(
    name: string,
    args: Record<string, unknown>,
    displayName: string,
    argsPreview: string,
  ): Promise<string> {
    const shortfallMessage = await this.checkBulkInsertShortfall(
      displayName,
      argsPreview,
      args,
    );
    if (shortfallMessage) {
      this.logger.warn(
        `tool_call ${displayName} bị chặn TRƯỚC approval: ${shortfallMessage}`,
      );
      await this.emitStep({
        type: 'tool_result',
        tool: displayName,
        status: EStepExecutionStatus.ERROR,
        resultPreview: shortfallMessage,
      });
      this.toolCalls.push({
        tool: displayName,
        status: EStepExecutionStatus.ERROR,
        resultPreview: shortfallMessage,
        argsPreview,
      });
      return shortfallMessage;
    }

    // checkBulkInsertShortfall() có thể vừa GHI ĐÈ args.query (gộp tuple tích
    // luỹ) — phải phân loại rủi ro SAU bước đó, dựa trên câu lệnh CUỐI CÙNG.
    if (this.isAutoApprovableInsert(name, args)) {
      this.logger.log(
        `tool_call ${displayName} tự chạy — INSERT rủi ro thấp (không đụng dữ liệu cũ), bỏ qua bước duyệt`,
      );
      const result = await this.executeTrackedToolCall(
        name,
        args,
        displayName,
        argsPreview,
      );
      // Đã thực thi đúng 1 lần câu lệnh gộp — dọn ngay, dù thành công hay
      // thất bại. Không dọn thì 1 lần fail (VD trùng unique constraint) sẽ
      // kéo theo đúng các tuple đã fail đó vào MỌI lần gộp sau trong cùng
      // lượt, lặp lại y hệt lỗi cũ vô thời hạn dù model viết dòng mới thật.
      this.clearInsertAccumulator(args.query as string);
      return result;
    }

    this.logger.log(
      `tool_call ${displayName} requires approval — blocked before execution`,
    );
    throw new ApprovalRequiredError(
      { provider: this.dto.provider, name, args },
      this.toolCalls,
    );
  }

  private async reuseCachedCall(
    displayName: string,
    argsPreview: string,
    attempts: number,
    cached: { resultPreview: string; feedText: string },
  ): Promise<string> {
    this.logger.log(
      `tool_call ${displayName} lặp lại lần ${attempts}, ĐÚNG tham số đã thành công trước đó — dùng lại kết quả cũ, không gọi tool thật lần nữa`,
    );
    await this.emitStep({ type: 'tool_call', tool: displayName, argsPreview });
    await this.emitStep({
      type: 'tool_result',
      tool: displayName,
      status: EStepExecutionStatus.SUCCESS,
      resultPreview: cached.resultPreview,
    });
    this.toolCalls.push({
      tool: displayName,
      status: EStepExecutionStatus.SUCCESS,
      resultPreview: cached.resultPreview,
      argsPreview,
    });
    return cached.feedText;
  }

  private async blockRepeatedCall(
    name: string,
    displayName: string,
    argsPreview: string,
    attempts: number,
  ): Promise<string> {
    const otherToolNames = this.mcpTools
      .map((t) => t.name)
      .filter((n) => n !== name);
    const suggestion =
      otherToolNames.length > 0
        ? `KHÔNG được gọi lại tool này. Nếu nhiệm vụ cần 1 HÀNH ĐỘNG (ghi/thêm/tạo/sửa dữ liệu...), hãy gọi tool phù hợp trong số các tool còn lại: ${otherToolNames.join(', ')}.`
        : 'Không còn tool nào khác của hệ thống này để thử.';
    const resultPreview = `Tool "${displayName}" đã được gọi với ĐÚNG tham số này ${attempts - 1} lần trước đó và không thực thi lại nữa. ${suggestion} Nếu không có tool nào phù hợp để hoàn thành yêu cầu, báo thẳng cho người dùng biết giới hạn đó thay vì im lặng bỏ cuộc.`;
    this.logger.warn(
      `tool_call ${displayName} bị chặn — lặp lại quá ${ORCHESTRATION_CONSTANTS.MAX_SAME_TOOL_CALL_REPEATS} lần với cùng tham số`,
    );
    await this.emitStep({
      type: 'tool_result',
      tool: displayName,
      status: EStepExecutionStatus.ERROR,
      resultPreview,
    });
    this.toolCalls.push({
      tool: displayName,
      status: EStepExecutionStatus.ERROR,
      resultPreview,
      argsPreview,
    });
    return resultPreview;
  }

  private async runToolCall(
    name: string,
    args: Record<string, unknown>,
    displayName: string,
    argsPreview: string,
    signature: string,
  ): Promise<string> {
    this.logger.log(`tool_call ${displayName} args=${JSON.stringify(args)}`);
    await this.emitStep({ type: 'tool_call', tool: displayName, argsPreview });

    let result: CallToolResponseDto;
    let text: string;
    let status: EStepExecutionStatus;
    let resultPreview: string;
    let transientAttempt = 0;

    while (true) {
      transientAttempt++;
      try {
        result = await this.mcpClient.callTool(
          {
            provider: this.dto.provider,
            name,
            args,
            ownerId: this.dto.userId,
            workspaceId: this.dto.workspaceId,
          },
          this.signal,
        );
      } catch (error) {
        if (this.signal?.aborted) {
          throw error;
        }

        const errorMessage = (error as Error).message;
        this.logger.warn(
          `tool_result ${displayName} FAILED (exception): ${errorMessage}`,
        );
        await this.emitStep({
          type: 'tool_result',
          tool: displayName,
          status: EStepExecutionStatus.ERROR,
          resultPreview: errorMessage,
        });
        this.toolCalls.push({
          tool: displayName,
          status: EStepExecutionStatus.ERROR,
          resultPreview: errorMessage,
          argsPreview,
        });
        return capToolResultSize(
          errorMessage,
          this.memoryManager.buildBudget(this.reactModelId)
            .toolResultCharBudget,
        );
      }

      text = extractTextFromMcpResult(result);
      status = result.isError
        ? EStepExecutionStatus.ERROR
        : EStepExecutionStatus.SUCCESS;
      resultPreview = formatResultPreview(text);

      const shouldRetryTransiently =
        status === EStepExecutionStatus.ERROR &&
        transientAttempt <
          ORCHESTRATION_CONSTANTS.MAX_TRANSIENT_TOOL_RETRY_ATTEMPTS &&
        classifyToolError(resultPreview) === 'retryable';
      if (!shouldRetryTransiently) break;

      this.logger.warn(
        `tool_result ${displayName} lỗi tạm thời (retryable) — tự thử lại lần ${transientAttempt + 1}/${ORCHESTRATION_CONSTANTS.MAX_TRANSIENT_TOOL_RETRY_ATTEMPTS}, ẩn với LLM: ${resultPreview}`,
      );
      await abortableSleep(
        ORCHESTRATION_CONSTANTS.TRANSIENT_RETRY_BACKOFF_MS,
        this.signal,
      );
    }

    if (status === 'error') {
      this.logger.warn(`tool_result ${displayName} FAILED: ${resultPreview}`);
    } else {
      this.logger.log(`tool_result ${displayName} ok: ${resultPreview}`);
    }

    await this.emitStep({
      type: 'tool_result',
      tool: displayName,
      status,
      resultPreview,
    });
    this.toolCalls.push({
      tool: displayName,
      status,
      resultPreview,
      argsPreview,
    });
    const feedText = capToolResultSize(
      text,
      this.memoryManager.buildBudget(this.reactModelId).toolResultCharBudget,
    );
    if (status === 'success') {
      this.successfulCallCache.set(signature, { resultPreview, feedText });
    }
    return feedText;
  }

  private emitStep(step: {
    type: 'tool_call' | 'tool_result';
    tool: string;
    status?: EStepExecutionStatus;
    resultPreview?: string;
    argsPreview?: string;
  }): Promise<void> {
    return this.agentStream.emitStep(
      {
        userId: this.dto.userId,
        channelId: this.dto.channelId,
        messageId: this.dto.messageId,
        channelType: this.dto.channelType,
        streamKey: this.dto.streamKey,
      },
      step,
    );
  }
}
