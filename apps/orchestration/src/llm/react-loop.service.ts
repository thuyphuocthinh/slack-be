import { Injectable, Logger } from '@nestjs/common';
import { traceable } from 'langsmith/traceable';
import { ORCHESTRATION_CONSTANTS, ORCHESTRATION_SELF_CHECK_PROMPT, ORCHESTRATION_SYSTEM_PROMPT } from '@slack/constants';
import { extractTextFromMcpResult } from '@slack/common';
import { McpClientService } from '../mcp/mcp-client.service';
import { MessageClientService } from '../message-client.service';
import { RunReactLoopRequestDto, RunReactLoopResponseDto, ToolCallTraceDto } from '../dto/react-loop.dto';
import { LlmStrategyFactory } from './strategy/llm-strategy.factory';
import { LlmToolResult } from './strategy/llm-strategy.interface';
import { AgentStreamService } from '../socket/agent-stream.service';

/**
 * ReAct loop provider-agnostic — trước đây (`GeminiReactService`) gọi
 * thẳng SDK Gemini, giờ đi qua `LlmStrategyFactory` (Strategy Pattern) nên
 * chạy được với bất kỳ model nào khai trong `LLM_MODEL_REGISTRY`
 * (Gemini/OpenAI/Anthropic) mà không phải sửa file này.
 *
 * KHÔNG tự tạo root trace (traceable) hay tự phát tín hiệu "done" — 1 turn
 * giờ có thể chỉ gồm quyết định của Supervisor (không chạy loop này), nên
 * việc bao trùm trace + phát "done" thuộc về tầng gọi ngoài cùng
 * (AiOrchestrationProcessor), đảm bảo đúng 1 root trace/1 "done" cho MỌI
 * turn bất kể có delegate hay không.
 */
@Injectable()
export class ReactLoopService {
  constructor(
    private readonly mcpClient: McpClientService,
    private readonly messageClient: MessageClientService,
    private readonly llmFactory: LlmStrategyFactory,
    private readonly agentStream: AgentStreamService,
  ) {}

  async run(dto: RunReactLoopRequestDto): Promise<RunReactLoopResponseDto> {
    const toolCalls: ToolCallTraceDto[] = [];

    const [mcpTools, history] = await Promise.all([
      this.mcpClient.getTools(dto.provider),
      this.messageClient.getRecentHistory({
        channelId: dto.channelId,
        userId: dto.userId,
        beforeMessageId: dto.triggerMessageId,
        limit: ORCHESTRATION_CONSTANTS.CHAT_HISTORY_LIMIT,
      }),
    ]);

    const { strategy, model } = this.llmFactory.resolve(dto.model ?? ORCHESTRATION_CONSTANTS.GEMINI_MODEL);

    const session = strategy.startChat({
      model,
      systemInstruction: ORCHESTRATION_SYSTEM_PROMPT,
      tools: mcpTools.map((t) => ({ name: t.name, description: t.description, parameters: t.inputSchema })),
      history, // ChatHistoryTurnDto {role:'user'|'model', text} khớp đúng LlmHistoryTurn
      // Giai đoạn 2, Step 5/7: temperature thấp cho bước gọi tool — ưu tiên
      // tool-call/tham số chính xác, nhất quán hơn là sáng tạo (chống
      // hallucination cơ bản theo checklist plan.md mục 3).
      temperature: ORCHESTRATION_CONSTANTS.REACT_LOOP_TEMPERATURE,
    });

    // Wrap trong scope của run() — nếu tầng gọi ngoài (processor) đang có
    // traceable() bao quanh, span này tự nest đúng cây theo AsyncLocalStorage
    // của langsmith, không cần truyền context tay.
    const callTool = traceable(
      async (name: string, args: Record<string, unknown>) => {
        // Giai đoạn 2, Step 6: namespace tên tool hiển thị/lưu trữ theo
        // "{provider}.{toolName}" — 1 turn giờ có thể gộp toolCalls từ NHIỀU
        // agent khác nhau (Step 3), 2 agent khác nhau có thể trùng tên tool
        // (VD "list_items"). Chỉ namespace phần hiển thị/emit/persist — tên
        // gọi THẬT xuống MCP server (`mcpClient.callTool`) vẫn dùng `name` gốc.
        const displayName = `${dto.provider}.${name}`;
        await this.emitStep(dto, { type: 'tool_call', tool: displayName });
        const result = await this.mcpClient.callTool({ provider: dto.provider, name, args, ownerId: dto.userId });
        const text = extractTextFromMcpResult(result);
        const status: 'success' | 'error' = result.isError ? 'error' : 'success';
        const resultPreview = this.truncatePreview(text);
        await this.emitStep(dto, { type: 'tool_result', tool: displayName, status, resultPreview });
        toolCalls.push({ tool: displayName, status, resultPreview });
        return text;
      },
      { name: 'mcp.callTool' },
    );

    let turn = await session.sendMessage(dto.prompt);
    let selfChecked = false;

    for (let step = 0; step < ORCHESTRATION_CONSTANTS.MAX_REACT_STEPS; step++) {
      if (turn.toolCalls.length === 0) {
        // Model rẻ hay dừng ngay khi vừa xong 1 tool call, kể cả khi đó mới
        // chỉ là bước khám phá cấu trúc chứ chưa có dữ liệu thật — ép thêm
        // đúng 1 lượt tự phản biện (lượt gọi model riêng, không phải dựa
        // vào model tự giác trong cùng lượt sinh câu trả lời) trước khi
        // chấp nhận đây là câu trả lời cuối. Chỉ nudge khi đã có tool call
        // và chỉ đúng 1 lần (tránh lặp vô hạn nếu model cứ khẳng định "đã đủ").
        if (!selfChecked && toolCalls.length > 0) {
          selfChecked = true;
          turn = await session.sendMessage(ORCHESTRATION_SELF_CHECK_PROMPT);
          continue;
        }
        return { answer: turn.text || 'Xin lỗi, mình chưa có câu trả lời phù hợp.', toolCalls };
      }

      const results: LlmToolResult[] = [];
      for (const call of turn.toolCalls) {
        const content = await callTool(call.name, call.args);
        results.push({ id: call.id, name: call.name, content });
      }

      turn = await session.sendMessage(results);
    }

    return { answer: turn.text || 'Xin lỗi, câu hỏi này cần nhiều bước hơn mình hỗ trợ được.', toolCalls };
  }

  /** Rút gọn kết quả tool thành 1 dòng ngắn để hiện preview trong timeline FE. */
  private truncatePreview(text: string, maxLen = 200): string {
    const oneLine = text.replace(/\s+/g, ' ').trim();
    return oneLine.length > maxLen ? `${oneLine.slice(0, maxLen)}…` : oneLine;
  }

  private emitStep(dto: RunReactLoopRequestDto, step: { type: 'tool_call' | 'tool_result'; tool: string; status?: 'success' | 'error'; resultPreview?: string }): Promise<void> {
    return this.agentStream.emitStep(
      { userId: dto.userId, channelId: dto.channelId, messageId: dto.messageId, channelType: dto.channelType },
      step,
    );
  }
}
