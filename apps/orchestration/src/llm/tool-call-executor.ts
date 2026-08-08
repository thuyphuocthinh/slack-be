import { Logger } from '@nestjs/common';
import { traceable } from 'langsmith/traceable';
import {
  ORCHESTRATION_CONSTANTS,
  EStepExecutionStatus,
} from '@slack/constants';
import { extractTextFromMcpResult } from '@slack/common';
import { McpClientService } from '../mcp/mcp-client.service';
import {
  RunReactLoopRequestDto,
  ToolCallTraceDto,
} from '../dto/react-loop.dto';
import { LlmToolCall, LlmToolResult } from './strategy/llm-strategy.interface';
import { AgentStreamService } from '../socket/agent-stream.service';
import { ApprovalRequiredError } from './approval-required.error';
import { CallToolResponseDto, McpToolDto } from '../dto/mcp.dto';
import { abortableSleep } from '../common/abortable-sleep.util';
import { capToolResultSize } from '../executor/tool-result-size-cap.util';
import { classifyToolError } from '../executor/tool-error-classifier.util';
import { PiiScrubberUtil } from '../executor/pii-scrubber.util';
import { MemoryManagerService } from '../memory/memory-manager.service';
import { ToolRepeatGuard } from './tool-repeat-guard';
import { InsertAccumulator } from './insert-accumulator';
import { ToolRiskGate } from './tool-risk-gate';

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

export interface ToolCallExecutorOptions {
  dto: RunReactLoopRequestDto;
  mcpTools: McpToolDto[];
  reactModelId: string;
  signal: AbortSignal;
}

export interface ToolCallExecutorDeps {
  mcpClient: McpClientService;
  agentStream: AgentStreamService;
  memoryManager: MemoryManagerService;
  logger: Logger;
  repeatGuard: ToolRepeatGuard;
  insertAccumulator: InsertAccumulator;
  riskGate: ToolRiskGate;
}

/**
 * Thực thi 1 tool call: hỏi ToolRiskGate xem có cho chạy không (destructive?
 * auto-approve INSERT?), dedup/cache theo ToolRepeatGuard, retry lỗi tạm thời
 * (transient), gọi MCP thật, ghi trace + emit step lên FE. Tách khỏi
 * ReactLoopRun để test được trực tiếp thay vì chỉ suy ra qua số lần gọi mock.
 * Xem thiết kế đầy đủ (WHY): slack-docs/Documents/Orchestration/code-notes/react-loop.service.md
 */
export class ToolCallExecutor {
  private readonly dto: RunReactLoopRequestDto;
  private readonly mcpTools: McpToolDto[];
  private readonly reactModelId: string;
  private readonly signal: AbortSignal;

  private readonly mcpClient: McpClientService;
  private readonly agentStream: AgentStreamService;
  private readonly memoryManager: MemoryManagerService;
  private readonly logger: Logger;
  private readonly repeatGuard: ToolRepeatGuard;
  private readonly insertAccumulator: InsertAccumulator;
  private readonly riskGate: ToolRiskGate;

  private readonly toolCalls: ToolCallTraceDto[] = [];

  // handleToolCall() bind + traceable() 1 LẦN ở constructor — gọi trực tiếp
  // this.handleToolCall(...) trong run() sẽ KHÔNG lên trace LangSmith.
  private readonly tracedHandleToolCall: (
    name: string,
    args: Record<string, unknown>,
  ) => Promise<string>;

  constructor(options: ToolCallExecutorOptions, deps: ToolCallExecutorDeps) {
    this.dto = options.dto;
    this.mcpTools = options.mcpTools;
    this.reactModelId = options.reactModelId;
    this.signal = options.signal;

    this.mcpClient = deps.mcpClient;
    this.agentStream = deps.agentStream;
    this.memoryManager = deps.memoryManager;
    this.logger = deps.logger;
    this.repeatGuard = deps.repeatGuard;
    this.insertAccumulator = deps.insertAccumulator;
    this.riskGate = deps.riskGate;

    this.tracedHandleToolCall = traceable(
      (name: string, args: Record<string, unknown>) =>
        this.handleToolCall(name, args),
      { name: 'mcp.callTool' },
    );
  }

  getToolCalls(): ToolCallTraceDto[] {
    return this.toolCalls;
  }

  hasAnySuccessfulToolCall(): boolean {
    return this.toolCalls.some((tc) => tc.status === 'success');
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
  run(toolCalls: LlmToolCall[]): Promise<LlmToolResult[]> {
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
    return this.insertAccumulator.tableKeyFor(query);
  }

  private async handleToolCall(
    name: string,
    args: Record<string, unknown>,
  ): Promise<string> {
    const displayName = `${this.dto.provider}.${name}`;
    const argsPreview = formatArgsPreview(args);

    if (this.riskGate.isDestructive(name)) {
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
    const attempts = this.repeatGuard.recordAttempt(signature);

    if (attempts > 1) {
      const cached = this.repeatGuard.getCachedSuccess(signature);
      if (cached) {
        return this.reuseCachedCall(displayName, argsPreview, attempts, cached);
      }
    }

    if (attempts > ORCHESTRATION_CONSTANTS.MAX_SAME_TOOL_CALL_REPEATS) {
      return this.blockRepeatedCall(name, displayName, argsPreview, attempts);
    }

    return this.runToolCall(name, args, displayName, argsPreview, signature);
  }

  /** Risk Gate (Giai đoạn 3, HITL) — chặn TRƯỚC KHI thực thi, trừ khi model
   * ghi thiếu dòng so với yêu cầu (nhắc sửa lại thay vì đẩy lên duyệt ngay). */
  private async handleDestructiveToolCall(
    name: string,
    args: Record<string, unknown>,
    displayName: string,
    argsPreview: string,
  ): Promise<string> {
    const shortfallMessage = await this.riskGate.checkBulkInsertShortfall(
      displayName,
      argsPreview,
      args,
    );
    if (shortfallMessage) {
      this.logger.warn(
        `tool_call ${displayName} bị chặn TRƯỚC approval: ${shortfallMessage}`,
      );
      await this.recordResult(
        displayName,
        EStepExecutionStatus.ERROR,
        shortfallMessage,
        argsPreview,
      );
      return shortfallMessage;
    }

    // checkBulkInsertShortfall() có thể vừa GHI ĐÈ args.query (gộp tuple tích
    // luỹ) — phải phân loại rủi ro SAU bước đó, dựa trên câu lệnh CUỐI CÙNG.
    if (this.riskGate.isAutoApprovableInsert(name, args)) {
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
      this.riskGate.clearAccumulatorFor(args.query as string);
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
    await this.recordResult(
      displayName,
      EStepExecutionStatus.SUCCESS,
      cached.resultPreview,
      argsPreview,
    );
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
    await this.recordResult(
      displayName,
      EStepExecutionStatus.ERROR,
      resultPreview,
      argsPreview,
    );
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

        // SDK/API provider đôi khi echo lại 1 phần request (VD header/token)
        // trong message lỗi — scrub trước khi log/hiện cho user, cùng cơ chế
        // đang dùng cho tool result thành công (McpClientService.scrubToolResult).
        const errorMessage = PiiScrubberUtil.scrub(
          (error as Error).message,
        ) as string;
        this.logger.warn(
          `tool_result ${displayName} FAILED (exception): ${errorMessage}`,
        );
        await this.recordResult(
          displayName,
          EStepExecutionStatus.ERROR,
          errorMessage,
          argsPreview,
        );
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

    await this.recordResult(displayName, status, resultPreview, argsPreview);
    const feedText = capToolResultSize(
      text,
      this.memoryManager.buildBudget(this.reactModelId).toolResultCharBudget,
    );
    if (status === 'success') {
      this.repeatGuard.cacheSuccess(signature, resultPreview, feedText);
    }
    return feedText;
  }

  private async recordResult(
    tool: string,
    status: EStepExecutionStatus,
    resultPreview: string,
    argsPreview?: string,
  ): Promise<void> {
    await this.emitStep({ type: 'tool_result', tool, status, resultPreview });
    this.toolCalls.push({ tool, status, resultPreview, argsPreview });
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
