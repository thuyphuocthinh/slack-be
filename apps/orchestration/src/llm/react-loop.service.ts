import { Injectable, Logger } from '@nestjs/common';
import { traceable } from 'langsmith/traceable';
import {
  ORCHESTRATION_CONSTANTS,
  ORCHESTRATION_SELF_CHECK_PROMPT,
  ORCHESTRATION_SYSTEM_PROMPT,
} from '@slack/constants';
import { extractTextFromMcpResult } from '@slack/common';
import { McpClientService } from '../mcp/mcp-client.service';
import {
  RunReactLoopRequestDto,
  RunReactLoopResponseDto,
  ToolCallTraceDto,
} from '../dto/react-loop.dto';
import { checkQuantity as checkQuantityUtil } from './quantity-check.util';
import { LlmStrategyFactory } from './strategy/llm-strategy.factory';
import {
  LlmToolResult,
  LlmTurnResult,
} from './strategy/llm-strategy.interface';
import { AgentStreamService } from '../socket/agent-stream.service';
import { withLlmRetry } from './with-llm-retry.util';
import { ApprovalRequiredError } from './approval-required.error';
import { CircuitBreakerService } from '../common/circuit-breaker.service';
import { CallToolResponseDto, McpToolDto } from '../dto/mcp.dto';
import { AgentCancellationService } from '../cancellation/agent-cancellation.service';
import { runCancellable } from '../common/cancellable-run.util';
import { abortableSleep } from '../common/abortable-sleep.util';
import { TurnCancelledError } from './turn-cancelled.error';
import {
  capToolResultSize,
  resolveDataCharBudget,
} from '../executor/tool-result-size-cap.util';
import { classifyToolError } from '../executor/tool-error-classifier.util';

// Ghi chú thiết kế đầy đủ (WHY): slack-docs/Documents/Orchestration/code-notes/react-loop.service.md
@Injectable()
export class ReactLoopService {
  private readonly logger = new Logger(ReactLoopService.name);

  constructor(
    private readonly mcpClient: McpClientService,
    private readonly llmFactory: LlmStrategyFactory,
    private readonly agentStream: AgentStreamService,
    private readonly circuitBreaker: CircuitBreakerService,
    private readonly cancellation: AgentCancellationService,
  ) {}

  async run(
    dto: RunReactLoopRequestDto,
    parentSignal?: AbortSignal,
  ): Promise<RunReactLoopResponseDto> {
    const toolCalls: ToolCallTraceDto[] = [];

    let confirmedText = '';
    const emitToken = (step: { type: 'token' | 'resync'; text: string }) => {
      this.agentStream
        .emitStep(
          {
            userId: dto.userId,
            channelId: dto.channelId,
            messageId: dto.messageId,
            channelType: dto.channelType,
            streamKey: dto.streamKey,
          },
          step,
        )
        .catch(() => {}); // fire and forget
    };
    const onToken = (chunk: string) => {
      confirmedText += chunk;
      emitToken({ type: 'token', text: chunk });
    };
    const resync = (text: string) => {
      confirmedText = text;
      emitToken({ type: 'resync', text });
    };

    return runCancellable(
      dto.messageId,
      this.cancellation,
      async (signal) => {
        const reactModelId =
          dto.model ??
          process.env.DEFAULT_REACT_MODEL ??
          ORCHESTRATION_CONSTANTS.DEFAULT_REACT_MODEL;

        const [mcpTools, systemInstruction] = await Promise.all([
          this.mcpClient.getTools(dto.provider, dto.prompt, signal),
          this.buildSystemInstruction(
            dto.provider,
            dto.userId,
            reactModelId,
            signal,
          ),
        ]);

        if (signal.aborted) {
          throw new TurnCancelledError(undefined);
        }

        const { strategy, model } = this.llmFactory.resolve(reactModelId);
        this.logger.log(
          `run() userId=${dto.userId} provider=${dto.provider} model=${model} toolsAvailable=${mcpTools.length}`,
        );

        const session = strategy.startChat({
          model,
          systemInstruction,
          tools: mcpTools.map((t) => ({
            name: t.name,
            description: t.description,
            parameters: t.inputSchema,
          })),
          history: dto.history,
          temperature: ORCHESTRATION_CONSTANTS.REACT_LOOP_TEMPERATURE,
        });

        const callSignatureCounts = new Map<string, number>();
        const successfulCallCache = new Map<
          string,
          { resultPreview: string; feedText: string }
        >();

        const callTool = traceable(
          (name: string, args: Record<string, unknown>) =>
            this.handleToolCall(
              name,
              args,
              dto,
              mcpTools,
              toolCalls,
              callSignatureCounts,
              successfulCallCache,
              reactModelId,
              signal,
            ),
          { name: 'mcp.callTool' },
        );

        // streamedAnything reset lại MỖI lần thử (đầu fn()) — chỉ cho retry
        // khi lần vừa lỗi CHƯA stream ra token nào (xem
        // ORCHESTRATION_CONSTANTS.MAX_LLM_CALL_RETRY_ATTEMPTS).
        const sendMessage = (
          input: string | LlmToolResult[],
          onTok?: (chunk: string) => void,
        ): Promise<LlmTurnResult> => {
          let streamedAnything = false;
          const trackedOnTok = onTok
            ? (chunk: string) => {
                streamedAnything = true;
                onTok(chunk);
              }
            : undefined;
          return this.circuitBreaker.run(`llm:${strategy.id}`, () =>
            withLlmRetry(
              () => {
                streamedAnything = false;
                return session.sendMessage(input, trackedOnTok, signal);
              },
              ORCHESTRATION_CONSTANTS.LLM_CALL_TIMEOUT_MS,
              `ReactLoop sendMessage() timeout sau ${ORCHESTRATION_CONSTANTS.LLM_CALL_TIMEOUT_MS / 1000}s (provider=${dto.provider}, model=${model})`,
              { signal, canRetry: () => !streamedAnything },
            ),
          );
        };

        const checkQuantity = () =>
          checkQuantityUtil(
            dto.prompt,
            toolCalls
              .map((tc) => `${tc.tool}: ${tc.resultPreview ?? ''}`)
              .join('\n'),
            strategy,
            model,
            this.circuitBreaker,
            this.logger,
            signal,
          );

        return this.executeReactLoop(
          dto,
          sendMessage,
          callTool,
          toolCalls,
          onToken,
          resync,
          checkQuantity,
        );
      },
      () => new TurnCancelledError(confirmedText || undefined),
      parentSignal,
    );
  }

  private async buildSystemInstruction(
    provider: string,
    userId: string,
    modelId: string,
    signal?: AbortSignal,
  ): Promise<string> {
    const mcpResources = await this.mcpClient.getResources(provider, signal);
    const resourceContents = await Promise.all(
      mcpResources.map(async (r) => {
        try {
          const content = await this.mcpClient.readResource(
            provider,
            r.uri,
            userId,
            signal,
          );
          return `\n--- Resource: ${r.name} ---\n${capToolResultSize(content, resolveDataCharBudget(modelId))}`;
        } catch (error) {
          this.logger.warn(
            `Failed to read resource ${r.uri}: ${(error as Error).message}`,
          );
          return '';
        }
      }),
    );

    let systemInstruction = ORCHESTRATION_SYSTEM_PROMPT;
    const injectedResources = resourceContents.filter(Boolean).join('\n');
    if (injectedResources) {
      systemInstruction += `\n\nBạn có sẵn các Context/Resources sau trong bộ nhớ để tham khảo, tuyệt đối ưu tiên sử dụng thông tin này nếu liên quan đến câu hỏi của người dùng:\n${injectedResources}`;
    }
    return systemInstruction;
  }

  private async handleToolCall(
    name: string,
    args: Record<string, unknown>,
    dto: RunReactLoopRequestDto,
    mcpTools: McpToolDto[],
    toolCalls: ToolCallTraceDto[],
    callSignatureCounts: Map<string, number>,
    successfulCallCache: Map<
      string,
      { resultPreview: string; feedText: string }
    >,
    modelId: string,
    signal?: AbortSignal,
  ): Promise<string> {
    if (mcpTools.find((t) => t.name === name)?.annotations?.destructiveHint) {
      this.logger.log(
        `tool_call ${dto.provider}.${name} requires approval — blocked before execution`,
      );
      throw new ApprovalRequiredError(
        { provider: dto.provider, name, args },
        toolCalls,
      );
    }

    const displayName = `${dto.provider}.${name}`;
    const signature = `${name}:${JSON.stringify(args)}`;
    const argsPreview = this.formatArgsPreview(args);

    const attempts = (callSignatureCounts.get(signature) ?? 0) + 1;
    callSignatureCounts.set(signature, attempts);

    if (attempts > 1) {
      const cached = successfulCallCache.get(signature);
      if (cached) {
        this.logger.log(
          `tool_call ${displayName} lặp lại lần ${attempts}, ĐÚNG tham số đã thành công trước đó — dùng lại kết quả cũ, không gọi tool thật lần nữa`,
        );
        await this.emitStep(dto, {
          type: 'tool_call',
          tool: displayName,
          argsPreview,
        });
        await this.emitStep(dto, {
          type: 'tool_result',
          tool: displayName,
          status: 'success',
          resultPreview: cached.resultPreview,
        });
        toolCalls.push({
          tool: displayName,
          status: 'success',
          resultPreview: cached.resultPreview,
          argsPreview,
        });
        return cached.feedText;
      }
    }

    if (attempts > ORCHESTRATION_CONSTANTS.MAX_SAME_TOOL_CALL_REPEATS) {
      const otherToolNames = mcpTools
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
      await this.emitStep(dto, {
        type: 'tool_result',
        tool: displayName,
        status: 'error',
        resultPreview,
      });
      toolCalls.push({
        tool: displayName,
        status: 'error',
        resultPreview,
        argsPreview,
      });
      return resultPreview;
    }

    this.logger.log(`tool_call ${displayName} args=${JSON.stringify(args)}`);
    await this.emitStep(dto, {
      type: 'tool_call',
      tool: displayName,
      argsPreview,
    });

    let result: CallToolResponseDto;
    let text: string;
    let status: 'success' | 'error';
    let resultPreview: string;
    let transientAttempt = 0;

    while (true) {
      transientAttempt++;
      try {
        result = await this.mcpClient.callTool(
          {
            provider: dto.provider,
            name,
            args,
            ownerId: dto.userId,
          },
          signal,
        );
      } catch (error) {
        if (signal?.aborted) {
          throw error;
        }

        const errorMessage = (error as Error).message;
        this.logger.warn(
          `tool_result ${displayName} FAILED (exception): ${errorMessage}`,
        );
        await this.emitStep(dto, {
          type: 'tool_result',
          tool: displayName,
          status: 'error',
          resultPreview: errorMessage,
        });
        toolCalls.push({
          tool: displayName,
          status: 'error',
          resultPreview: errorMessage,
          argsPreview,
        });
        return capToolResultSize(errorMessage, resolveDataCharBudget(modelId));
      }

      text = extractTextFromMcpResult(result);
      status = result.isError ? 'error' : 'success';
      resultPreview = this.formatResultPreview(text);

      const shouldRetryTransiently =
        status === 'error' &&
        transientAttempt <
          ORCHESTRATION_CONSTANTS.MAX_TRANSIENT_TOOL_RETRY_ATTEMPTS &&
        classifyToolError(resultPreview) === 'retryable';
      if (!shouldRetryTransiently) break;

      this.logger.warn(
        `tool_result ${displayName} lỗi tạm thời (retryable) — tự thử lại lần ${transientAttempt + 1}/${ORCHESTRATION_CONSTANTS.MAX_TRANSIENT_TOOL_RETRY_ATTEMPTS}, ẩn với LLM: ${resultPreview}`,
      );
      await abortableSleep(
        ORCHESTRATION_CONSTANTS.TRANSIENT_RETRY_BACKOFF_MS,
        signal,
      );
    }

    if (status === 'error') {
      this.logger.warn(`tool_result ${displayName} FAILED: ${resultPreview}`);
    } else {
      this.logger.log(`tool_result ${displayName} ok: ${resultPreview}`);
    }

    await this.emitStep(dto, {
      type: 'tool_result',
      tool: displayName,
      status,
      resultPreview,
    });
    toolCalls.push({ tool: displayName, status, resultPreview, argsPreview });
    const feedText = capToolResultSize(text, resolveDataCharBudget(modelId));
    if (status === 'success') {
      successfulCallCache.set(signature, { resultPreview, feedText });
    }
    return feedText;
  }

  private async executeReactLoop(
    dto: RunReactLoopRequestDto,
    sendMessage: (
      input: string | LlmToolResult[],
      onToken?: (chunk: string) => void,
    ) => Promise<LlmTurnResult>,
    callTool: (name: string, args: Record<string, unknown>) => Promise<string>,
    toolCalls: ToolCallTraceDto[],
    onToken: (chunk: string) => void,
    resync: (text: string) => void,
    checkQuantity: () => Promise<{
      requiredCount: number;
      achievedCount: number;
    }>,
  ): Promise<RunReactLoopResponseDto> {
    let turn = await sendMessage(dto.prompt, onToken);
    let selfChecked = false;

    for (let step = 0; step < ORCHESTRATION_CONSTANTS.MAX_REACT_STEPS; step++) {
      if (turn.toolCalls.length === 0) {
        if (!selfChecked && toolCalls.length > 0) {
          selfChecked = true;
          const answerBeforeSelfCheck = turn.text;

          const { requiredCount, achievedCount } = await checkQuantity();
          if (requiredCount > 0 && requiredCount !== achievedCount) {
            this.logger.log(
              `quantity mismatch requiredCount=${requiredCount} achievedCount=${achievedCount} — nudging to continue`,
            );
            const nudgeTurn = await sendMessage(
              `Yêu cầu cần xử lý đúng ${requiredCount} bản ghi, nhưng theo kết quả tool hiện tại mới có ${achievedCount}. Hãy tiếp tục thực hiện phần còn thiếu trước khi trả lời.`,
              onToken,
            );
            if (nudgeTurn.toolCalls.length > 0) {
              resync('');
              turn = nudgeTurn;
              continue;
            }
            this.logger.log(
              `run() done at step=${step} toolCalls=${toolCalls.length} (quantity vẫn thiếu nhưng model không gọi thêm tool)`,
            );
            resync(
              answerBeforeSelfCheck ||
                'Xin lỗi, mình chưa có câu trả lời phù hợp.',
            );
            return {
              answer:
                answerBeforeSelfCheck ||
                'Xin lỗi, mình chưa có câu trả lời phù hợp.',
              toolCalls,
            };
          }

          this.logger.log('self-check nudge triggered');
          const selfCheckTurn = await sendMessage(
            ORCHESTRATION_SELF_CHECK_PROMPT,
            onToken,
          );
          if (selfCheckTurn.toolCalls.length > 0) {
            resync('');
            turn = selfCheckTurn;
            continue;
          }
          this.logger.log(
            `run() done at step=${step} toolCalls=${toolCalls.length} (giữ câu trả lời TRƯỚC self-check)`,
          );
          resync(
            answerBeforeSelfCheck ||
              'Xin lỗi, mình chưa có câu trả lời phù hợp.',
          );
          return {
            answer:
              answerBeforeSelfCheck ||
              'Xin lỗi, mình chưa có câu trả lời phù hợp.',
            toolCalls,
          };
        }
        this.logger.log(
          `run() done at step=${step} toolCalls=${toolCalls.length}`,
        );
        return {
          answer: turn.text || 'Xin lỗi, mình chưa có câu trả lời phù hợp.',
          toolCalls,
        };
      }

      resync('');

      const results: LlmToolResult[] = [];
      for (const call of turn.toolCalls) {
        const content = await callTool(call.name, call.args);
        results.push({ id: call.id, name: call.name, content });
      }

      turn = await sendMessage(results, onToken);
    }

    this.logger.warn(
      `run() hit MAX_REACT_STEPS=${ORCHESTRATION_CONSTANTS.MAX_REACT_STEPS} userId=${dto.userId}`,
    );
    const partialWriteCaveat = toolCalls.some((tc) => tc.status === 'success')
      ? ' Một số hành động (đọc/ghi dữ liệu) đã thực hiện THÀNH CÔNG trước khi dừng — kiểm tra lại kết quả hiện có trước khi yêu cầu lại, tránh lặp lại đúng thao tác đã làm.'
      : '';
    return {
      answer:
        (turn.text ||
          'Xin lỗi, câu hỏi này cần nhiều bước hơn mình hỗ trợ được.') +
        partialWriteCaveat,
      toolCalls,
    };
  }

  /** Gộp về 1 dòng, không cắt bớt — xem code-notes/react-loop.service.md */
  private formatResultPreview(text: string): string {
    return text.replace(/\s+/g, ' ').trim();
  }

  /** Xem code-notes/react-loop.service.md */
  private formatArgsPreview(args: Record<string, unknown>): string {
    const values = Object.values(args);
    if (values.length === 1 && typeof values[0] === 'string') {
      return values[0];
    }
    return JSON.stringify(args, null, 2);
  }

  private emitStep(
    dto: RunReactLoopRequestDto,
    step: {
      type: 'tool_call' | 'tool_result';
      tool: string;
      status?: 'success' | 'error';
      resultPreview?: string;
      argsPreview?: string;
    },
  ): Promise<void> {
    return this.agentStream.emitStep(
      {
        userId: dto.userId,
        channelId: dto.channelId,
        messageId: dto.messageId,
        channelType: dto.channelType,
        streamKey: dto.streamKey,
      },
      step,
    );
  }
}
