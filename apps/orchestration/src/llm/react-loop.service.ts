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
import { LlmStrategyFactory } from './strategy/llm-strategy.factory';
import {
  LlmToolResult,
  LlmTurnResult,
} from './strategy/llm-strategy.interface';
import { AgentStreamService } from '../socket/agent-stream.service';
import { withTimeout } from './with-timeout.util';
import { ApprovalRequiredError } from './approval-required.error';
import { CircuitBreakerService } from '../common/circuit-breaker.service';
import { CallToolResponseDto, McpToolDto } from '../dto/mcp.dto';
import { AgentCancellationService } from '../cancellation/agent-cancellation.service';
import { runCancellable } from '../common/cancellable-run.util';
import { TurnCancelledError } from './turn-cancelled.error';
import { capToolResultSize } from '../executor/tool-result-size-cap.util';

// Root trace + "done" thuộc về AiOrchestrationProcessor, không phải ở đây.
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

  async run(dto: RunReactLoopRequestDto): Promise<RunReactLoopResponseDto> {
    const toolCalls: ToolCallTraceDto[] = [];

    const [mcpTools, systemInstruction] = await Promise.all([
      this.mcpClient.getTools(dto.provider, dto.prompt),
      this.buildSystemInstruction(dto.provider, dto.userId),
    ]);

    const { strategy, model } = this.llmFactory.resolve(
      dto.model ??
        process.env.DEFAULT_REACT_MODEL ??
        ORCHESTRATION_CONSTANTS.DEFAULT_REACT_MODEL,
    );
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

    // Đếm theo chữ ký (tool + tham số) trong PHẠM VI 1 lượt run() — chống LLM
    // tự lặp gọi y hệt vô ích (mục 4, xem handleToolCall()).
    const callSignatureCounts = new Map<string, number>();
    // Cache kết quả THÀNH CÔNG theo chữ ký, cùng phạm vi 1 lượt run() — model
    // đôi khi tự gọi lại ĐÚNG 1 tool đã thành công (do self-check nudge nghi
    // ngờ thừa, hoặc chính 1 response chứa 2 tool_call y hệt cùng lúc). Prompt
    // dặn "đừng gọi lại" chỉ giảm xác suất chứ không chặn được — chặn thật ở
    // đây: gặp lại đúng chữ ký đã thành công thì trả thẳng kết quả cũ, không
    // đánh tool thật thêm lần nào nữa. Chỉ cache khi THÀNH CÔNG — lỗi vẫn phải
    // đi qua callSignatureCounts bên dưới (retry sau lỗi thoáng qua vẫn hợp lý).
    const successfulCallCache = new Map<
      string,
      { resultPreview: string; feedText: string }
    >();

    // Wrap ở đây để nest đúng cây trace nếu processor đang có traceable() bao quanh.
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
        ),
      { name: 'mcp.callTool' },
    );

    // Luôn khớp CHÍNH XÁC với những gì FE đang hiển thị (được reset đúng lúc
    // FE cũng được báo resync) — dùng để: (a) không có tác dụng gì thêm khi
    // turn xong bình thường (answer đã tự trả về đúng chỗ), (b) làm nội dung
    // lưu lại khi bị Stop giữa chừng, thay vì vứt bỏ hết những gì đã stream.
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

    // runCancellable() poll Redis (Stop/Cancel) định kỳ, abort() ngay khi phát
    // hiện — signal truyền xuống tận SDK provider nên huỷ được GIỮA lúc đang
    // stream, không phải đợi hết response mới dừng.
    return runCancellable(
      dto.messageId,
      this.cancellation,
      (signal) => {
        const sendMessage = (
          input: string | LlmToolResult[],
          onTok?: (chunk: string) => void,
        ): Promise<LlmTurnResult> =>
          this.circuitBreaker.run(`llm:${strategy.id}`, () =>
            withTimeout(
              session.sendMessage(input, onTok, signal),
              ORCHESTRATION_CONSTANTS.LLM_CALL_TIMEOUT_MS,
              `ReactLoop sendMessage() timeout sau ${ORCHESTRATION_CONSTANTS.LLM_CALL_TIMEOUT_MS / 1000}s (provider=${dto.provider}, model=${model})`,
            ),
          );

        return this.executeReactLoop(
          dto,
          sendMessage,
          callTool,
          toolCalls,
          onToken,
          resync,
        );
      },
      // Giữ lại đúng phần đã stream (đã khớp FE nhờ resync ở trên) làm nội
      // dung lưu — giống ChatGPT/Claude: dừng thì giữ nguyên phần đã có,
      // không xoá sạch thay bằng 1 câu thông báo.
      () => new TurnCancelledError(confirmedText || undefined),
    );
  }

  private async buildSystemInstruction(
    provider: string,
    userId: string,
  ): Promise<string> {
    const mcpResources = await this.mcpClient.getResources(provider);
    const resourceContents = await Promise.all(
      mcpResources.map(async (r) => {
        try {
          const content = await this.mcpClient.readResource(
            provider,
            r.uri,
            userId,
          );
          return `\n--- Resource: ${r.name} ---\n${capToolResultSize(content)}`;
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

    // Mục 4 — LLM tự gọi lại CÙNG tool với CÙNG tham số nhiều lần (thường sau
    // khi thấy lỗi mà không đổi cách) trông như 1 vòng lặp bị "kẹt" trên UI.
    // Đây KHÁC với retry nội bộ của McpClientService (mất kết nối/session) —
    // ở đó lỗi được xử lý và ẩn khỏi LLM; ở đây LLM chủ động quyết định gọi
    // lại. Vượt ngưỡng thì chặn trước khi gọi tool thật, trả thẳng 1 lời nhắc
    // để LLM tự đổi hướng thay vì lặp vô ích.
    const attempts = (callSignatureCounts.get(signature) ?? 0) + 1;
    callSignatureCounts.set(signature, attempts);
    if (attempts > ORCHESTRATION_CONSTANTS.MAX_SAME_TOOL_CALL_REPEATS) {
      // Không chỉ nói chung chung "thử cách khác" — model hay đọc xong rồi
      // vẫn gọi lại đúng tool đọc đó thay vì chuyển sang tool HÀNH ĐỘNG. Liệt
      // kê thẳng tên các tool KHÁC còn dùng được (nhất là tool ghi/hành động)
      // ngay tại điểm chặn, để model có 1 bước tiếp theo cụ thể thay vì phải
      // tự nhớ lại nguyên tắc chung trong system prompt.
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
      toolCalls.push({ tool: displayName, status: 'error', resultPreview });
      return resultPreview;
    }

    // Đây là lần gọi LẶP LẠI (attempts > 1) nhưng CHƯA vượt ngưỡng chặn ở
    // trên — model tự gọi lại ĐÚNG tool đã thành công (self-check nudge nghi
    // ngờ thừa, hoặc 1 response chứa 2 tool_call y hệt cùng lúc). Dùng lại kết
    // quả cũ thay vì tốn 1 lượt tool thật vô ích — model vẫn nhận được y hệt
    // nội dung nó sẽ nhận nếu gọi thật. Không cache lỗi, nên lần lặp sau 1 lỗi
    // thoáng qua vẫn đi tiếp xuống gọi tool thật như cũ (có thể lỗi đã hết).
    if (attempts > 1) {
      const cached = successfulCallCache.get(signature);
      if (cached) {
        this.logger.log(
          `tool_call ${displayName} lặp lại lần ${attempts}, ĐÚNG tham số đã thành công trước đó — dùng lại kết quả cũ, không gọi tool thật lần nữa`,
        );
        await this.emitStep(dto, { type: 'tool_call', tool: displayName });
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
        });
        return cached.feedText;
      }
    }

    this.logger.log(`tool_call ${displayName} args=${JSON.stringify(args)}`);
    await this.emitStep(dto, { type: 'tool_call', tool: displayName });

    let result: CallToolResponseDto;
    try {
      result = await this.mcpClient.callTool({
        provider: dto.provider,
        name,
        args,
        ownerId: dto.userId,
      });
    } catch (error) {
      // Trước đây: exception bay thẳng qua đây, bỏ luôn bước emit tool_result
      // bên dưới — dòng tool-call trên UI kẹt ở trạng thái "đang chạy" tới hết
      // turn. Bắt lại ngay tại đây, emit đúng 1 lần tool_result lỗi, và trả
      // lỗi này về CHO LLM (không throw tiếp) để nó tự quyết định bước kế.
      const resultPreview = (error as Error).message;
      this.logger.warn(
        `tool_result ${displayName} FAILED (exception): ${resultPreview}`,
      );
      await this.emitStep(dto, {
        type: 'tool_result',
        tool: displayName,
        status: 'error',
        resultPreview,
      });
      toolCalls.push({ tool: displayName, status: 'error', resultPreview });
      return capToolResultSize(resultPreview);
    }

    const text = extractTextFromMcpResult(result);
    const status: 'success' | 'error' = result.isError ? 'error' : 'success';
    const resultPreview = this.formatResultPreview(text);

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
    toolCalls.push({ tool: displayName, status, resultPreview });
    // resultPreview (trace UI) giữ NGUYÊN VĂN đầy đủ — chỉ cap phần feed
    // NGƯỢC LẠI cho LLM, tránh 1 kết quả tool quá lớn (VD JSON lồng nhau từ
    // dynamic provider) làm sendMessage() kế tiếp timeout vì context quá to.
    const feedText = capToolResultSize(text);
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
  ): Promise<RunReactLoopResponseDto> {
    let turn = await sendMessage(dto.prompt, onToken);
    let selfChecked = false;

    for (let step = 0; step < ORCHESTRATION_CONSTANTS.MAX_REACT_STEPS; step++) {
      if (turn.toolCalls.length === 0) {
        if (!selfChecked && toolCalls.length > 0) {
          selfChecked = true;
          const answerBeforeSelfCheck = turn.text;
          this.logger.log('self-check nudge triggered');
          const selfCheckTurn = await sendMessage(
            ORCHESTRATION_SELF_CHECK_PROMPT,
            onToken,
          );
          if (selfCheckTurn.toolCalls.length > 0) {
            // Vòng self-check tự quyết định cần tool tiếp — text nó vừa
            // stream (nếu có) không phải câu trả lời, sẽ tiếp tục vòng lặp.
            resync('');
            turn = selfCheckTurn;
            continue;
          }
          this.logger.log(
            `run() done at step=${step} toolCalls=${toolCalls.length} (giữ câu trả lời TRƯỚC self-check)`,
          );
          // Vòng self-check vừa stream thêm text (thường là xác nhận lại) SAU
          // câu trả lời gốc — nhưng câu trả lời CUỐI là answerBeforeSelfCheck,
          // không phải nội dung self-check vừa nói. Resync về đúng
          // answerBeforeSelfCheck để FE không còn hiện phần thừa đó (nguyên
          // tắc "stream = save": FE lúc này phải khớp CHÍNH XÁC bằng những gì
          // cuối cùng được lưu).
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

      // Vòng này vừa có tool-call — text vừa stream (nếu có, kiểu "Để tôi
      // kiểm tra...") chỉ là tường thuật tạm thời, KHÔNG phải câu trả lời
      // cuối (câu trả lời thật đến từ vòng sau, sau khi có kết quả tool).
      // Resync để FE xoá phần này đi, tránh hiện dính vào câu trả lời thật.
      resync('');

      // Chạy TUẦN TỰ, không Promise.all — chạy song song từng gây 2 vấn đề
      // thật: (1) event tool_call/tool_result gửi cho FE chỉ mang tên tool,
      // không có id riêng biệt, nên FE không khớp đúng được result với call
      // khi có >1 lời gọi CÙNG tên chạy chồng lấn; (2) tool bị Risk Gate chặn
      // (destructiveHint) throw gần như ngay lập tức trong khi tool an toàn
      // đi cùng batch vẫn đang chạy dở — promise đó thành "mồ côi", kết quả
      // của nó trồi lên sau khi turn đã bị cắt để chờ duyệt. Chạy tuần tự loại
      // bỏ cả 2 vì không bao giờ có quá 1 tool đang "in-flight" cùng lúc.
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
    return {
      answer:
        turn.text ||
        'Xin lỗi, câu hỏi này cần nhiều bước hơn mình hỗ trợ được.',
      toolCalls,
    };
  }

  /** Gộp về 1 dòng (bỏ xuống dòng/khoảng trắng thừa) để hiện gọn trong timeline FE — KHÔNG cắt bớt, trả về đầy đủ. */
  private formatResultPreview(text: string): string {
    return text.replace(/\s+/g, ' ').trim();
  }

  private emitStep(
    dto: RunReactLoopRequestDto,
    step: {
      type: 'tool_call' | 'tool_result';
      tool: string;
      status?: 'success' | 'error';
      resultPreview?: string;
    },
  ): Promise<void> {
    return this.agentStream.emitStep(
      {
        userId: dto.userId,
        channelId: dto.channelId,
        messageId: dto.messageId,
        channelType: dto.channelType,
      },
      step,
    );
  }
}
