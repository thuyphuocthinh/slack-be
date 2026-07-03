import { Injectable, Logger } from '@nestjs/common';
import { traceable } from 'langsmith/traceable';
import { ORCHESTRATION_CONSTANTS, ORCHESTRATION_SELF_CHECK_PROMPT, ORCHESTRATION_SYSTEM_PROMPT } from '@slack/constants';
import { extractTextFromMcpResult } from '@slack/common';
import { McpClientService } from '../mcp/mcp-client.service';
import { RunReactLoopRequestDto, RunReactLoopResponseDto, ToolCallTraceDto } from '../dto/react-loop.dto';
import { LlmStrategyFactory } from './strategy/llm-strategy.factory';
import { LlmToolResult } from './strategy/llm-strategy.interface';
import { AgentStreamService } from '../socket/agent-stream.service';

// Root trace + "done" thuộc về AiOrchestrationProcessor, không phải ở đây.
@Injectable()
export class ReactLoopService {
  private readonly logger = new Logger(ReactLoopService.name);

  constructor(
    private readonly mcpClient: McpClientService,
    private readonly llmFactory: LlmStrategyFactory,
    private readonly agentStream: AgentStreamService,
  ) { }

  async run(dto: RunReactLoopRequestDto): Promise<RunReactLoopResponseDto> {
    const toolCalls: ToolCallTraceDto[] = [];

    const mcpTools = await this.mcpClient.getTools(dto.provider);

    const { strategy, model } = this.llmFactory.resolve(
      dto.model ?? process.env.DEFAULT_REACT_MODEL ?? ORCHESTRATION_CONSTANTS.DEFAULT_REACT_MODEL,
    );
    this.logger.log(`run() userId=${dto.userId} provider=${dto.provider} model=${model} toolsAvailable=${mcpTools.length}`);

    const session = strategy.startChat({
      model,
      systemInstruction: ORCHESTRATION_SYSTEM_PROMPT,
      tools: mcpTools.map((t) => ({ name: t.name, description: t.description, parameters: t.inputSchema })),
      history: dto.history,
      temperature: ORCHESTRATION_CONSTANTS.REACT_LOOP_TEMPERATURE,
    });

    // Wrap ở đây để nest đúng cây trace nếu processor đang có traceable() bao quanh.
    const callTool = traceable(
      async (name: string, args: Record<string, unknown>) => {
        const displayName = `${dto.provider}.${name}`;
        this.logger.log(`tool_call ${displayName} args=${JSON.stringify(args)}`);
        await this.emitStep(dto, { type: 'tool_call', tool: displayName });
        const result = await this.mcpClient.callTool({ provider: dto.provider, name, args, ownerId: dto.userId });
        const text = extractTextFromMcpResult(result);
        const status: 'success' | 'error' = result.isError ? 'error' : 'success';
        const resultPreview = this.truncatePreview(text);
        if (status === 'error') {
          this.logger.warn(`tool_result ${displayName} FAILED: ${resultPreview}`);
        } else {
          this.logger.log(`tool_result ${displayName} ok: ${resultPreview}`);
        }
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
        if (!selfChecked && toolCalls.length > 0) {
          selfChecked = true;
          this.logger.log('self-check nudge triggered');
          turn = await session.sendMessage(ORCHESTRATION_SELF_CHECK_PROMPT);
          continue;
        }
        this.logger.log(`run() done at step=${step} toolCalls=${toolCalls.length}`);
        return { answer: turn.text || 'Xin lỗi, mình chưa có câu trả lời phù hợp.', toolCalls };
      }

      const results: LlmToolResult[] = [];
      for (const call of turn.toolCalls) {
        const content = await callTool(call.name, call.args);
        results.push({ id: call.id, name: call.name, content });
      }

      turn = await session.sendMessage(results);
    }

    this.logger.warn(`run() hit MAX_REACT_STEPS=${ORCHESTRATION_CONSTANTS.MAX_REACT_STEPS} userId=${dto.userId}`);
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
