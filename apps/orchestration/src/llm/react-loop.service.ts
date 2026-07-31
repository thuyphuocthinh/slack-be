import { Injectable, Logger } from '@nestjs/common';
import {
  ORCHESTRATION_CONSTANTS,
  ORCHESTRATION_SYSTEM_PROMPT,
} from '@slack/constants';
import { McpClientService } from '../mcp/mcp-client.service';
import {
  RunReactLoopRequestDto,
  RunReactLoopResponseDto,
} from '../dto/react-loop.dto';
import { LlmStrategyFactory } from './strategy/llm-strategy.factory';
import { AgentStreamService } from '../socket/agent-stream.service';
import { CircuitBreakerService } from '../common/circuit-breaker.service';
import { AgentCancellationService } from '../cancellation/agent-cancellation.service';
import { runCancellable } from '../common/cancellable-run.util';
import { TurnCancelledError } from './turn-cancelled.error';
import {
  capToolResultSize,
  resolveDataCharBudget,
} from '../executor/tool-result-size-cap.util';
import { ReactLoopRun } from './react-loop-run';

// Ghi chú thiết kế đầy đủ (WHY): slack-docs/Documents/Orchestration/code-notes/react-loop.service.md
// Logic chi tiết 1 lượt chạy (tool call, self-check, quantity-nudge...) nằm
// ở ReactLoopRun (react-loop-run.ts) — file này chỉ dựng dependencies rồi giao việc.
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

        const reactLoopRun = new ReactLoopRun(
          { dto, mcpTools, strategy, model, reactModelId, session, signal },
          {
            mcpClient: this.mcpClient,
            agentStream: this.agentStream,
            circuitBreaker: this.circuitBreaker,
            logger: this.logger,
          },
        );

        return reactLoopRun.execute(onToken, resync);
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
}
