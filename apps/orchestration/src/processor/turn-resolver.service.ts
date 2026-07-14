import { Injectable, Logger } from '@nestjs/common';
import { IProcessAiTriggerJobData } from '@slack/queue';
import { ORCHESTRATION_CONSTANTS } from '@slack/constants';
import { MessageClientService } from '../message-client.service';
import { ReactLoopService } from '../llm/react-loop.service';
import { SupervisorService } from '../llm/supervisor.service';
import { AgentStreamService } from '../socket/agent-stream.service';
import {
  AvailableAgentDto,
  DelegationDto,
  SupervisorRoundDto,
} from '../dto/supervisor.dto';
import { ToolCallTraceDto } from '../dto/react-loop.dto';
import { ChatHistoryTurnDto } from '../dto/message-client.dto';
import { ApprovalRequiredError } from '../llm/approval-required.error';
import { AgentCancellationService } from '../cancellation/agent-cancellation.service';
import { runCancellable } from '../common/cancellable-run.util';
import { TurnCancelledError } from '../llm/turn-cancelled.error';
import { describeExternalServiceError } from '../llm/external-service-error.util';
import { CheckpointPauseService } from './checkpoint-pause.service';
import { buildOnToken } from './agent-stream-token.util';
import {
  AnswerResult,
  ApprovalRequiredDelegateResult,
  DelegateRoundResult,
  buildAnswer,
} from './orchestration-answer.types';

// Giai đoạn 2/3 (Supervisor multi-round + HITL) — vòng lặp "Supervisor quyết
// định respond/delegate" tách riêng khỏi AiOrchestrationProcessor (chỉ còn lo
// vòng đời job/turn) và khỏi CheckpointPauseService (chỉ lo việc TẠO checkpoint).
@Injectable()
export class TurnResolverService {
  private readonly logger = new Logger(TurnResolverService.name);

  constructor(
    private readonly messageClient: MessageClientService,
    private readonly reactLoop: ReactLoopService,
    private readonly supervisor: SupervisorService,
    private readonly agentStream: AgentStreamService,
    private readonly cancellation: AgentCancellationService,
    private readonly checkpointPause: CheckpointPauseService,
  ) {}

  // Supervisor có thể delegate nhiều vòng, mỗi vòng nhiều agent song song
  // (fan-out). MAX_SUPERVISOR_ROUNDS chặn ping-pong vô hạn — hết vòng thì bắt
  // buộc tổng hợp lại thay vì trả thẳng kết quả thô của vòng cuối.
  async resolveAnswer(
    data: IProcessAiTriggerJobData,
    replyMessageId: string,
  ): Promise<AnswerResult> {
    const { userId, channelId, messageId, channelType } = data;
    const [prompt, agents, history] = await Promise.all([
      this.messageClient.getMessageText({ id: messageId, userId }),
      this.supervisor.getAvailableAgents(userId),
      this.messageClient.getRecentHistory({
        channelId,
        userId,
        beforeMessageId: messageId,
        limit: ORCHESTRATION_CONSTANTS.CHAT_HISTORY_LIMIT,
      }),
    ]);

    const rounds: SupervisorRoundDto[] = [];
    const toolCalls: ToolCallTraceDto[] = [];

    for (
      let round = 0;
      round < ORCHESTRATION_CONSTANTS.MAX_SUPERVISOR_ROUNDS;
      round++
    ) {
      // decide() dùng generateStructured() (không stream) nên không bọc được
      // AbortSignal như ReactLoop/synthesize() — kiểm tra cờ huỷ GIỮA các vòng
      // là đủ, vì decide() vốn đã là 1 lệnh gọi ngắn (JSON quyết định, không
      // phải câu trả lời dài).
      if (await this.cancellation.isCancelled(replyMessageId)) {
        // Chưa có gì đang stream ở đúng thời điểm này (đang giữa 2 vòng) —
        // giữ lại kết quả delegate GẦN NHẤT đã có (nếu có) làm nội dung lưu,
        // thay vì xoá sạch về 1 câu thông báo chung chung.
        throw new TurnCancelledError(
          rounds.length > 0 ? rounds[rounds.length - 1].result : undefined,
        );
      }
      const decision = await this.supervisor.decide(
        prompt,
        agents,
        rounds,
        history,
      );

      if (decision.action === 'respond') {
        // Nguyên tắc "stream = save":
        // - rounds.length === 1: đúng 1 delegate đã trả lời — dùng thẳng kết
        //   quả ĐÃ STREAM của nó (rounds[0].result), bỏ qua decision.answer
        //   (decide() không stream, paraphrase sẽ khác nội dung đã hiện ra).
        // - rounds.length > 1: cần tổng hợp thật nhiều agent — gọi lại
        //   synthesize() (CÓ stream, khác decide()) để nội dung stream ra và
        //   nội dung lưu luôn khớp nhau, thay vì dùng decision.answer chưa
        //   từng stream.
        // - rounds.length === 0: Supervisor tự trả lời ngay, chưa từng
        //   delegate — không có gì để stream lại (decide() không stream),
        //   biết là ngoại lệ chưa xử lý, chấp nhận không stream cho case này
        //   (thường là câu ngắn/không cần dữ liệu, đổi 1 lượt LLM để có
        //   stream không đáng).
        if (rounds.length === 1) {
          return buildAnswer(rounds[0].result, toolCalls);
        }
        if (rounds.length > 1) {
          const accumulator = { text: '' };
          const finalAnswer = await runCancellable(
            replyMessageId,
            this.cancellation,
            (signal) =>
              this.supervisor.synthesize(
                prompt,
                rounds,
                buildOnToken(
                  this.agentStream,
                  userId,
                  channelId,
                  replyMessageId,
                  channelType,
                  accumulator,
                ),
                signal,
              ),
            () => new TurnCancelledError(accumulator.text || undefined),
          );
          return buildAnswer(finalAnswer, toolCalls);
        }
        return buildAnswer(
          decision.answer || 'Xin lỗi, mình chưa có câu trả lời phù hợp.',
          toolCalls,
        );
      }

      const delegations = this.dedupeByAgent(decision.delegations ?? []);

      // Khắc phục lỗi LLM trả về label (tên agent) thay vì provider ID (đặc biệt với Dynamic Agent có ID là UUID)
      delegations.forEach((d) => {
        const safeAgent = d.agent || '';
        const matchedAgent = agents.find(
          (a) =>
            a.provider === safeAgent ||
            a.label.toLowerCase() === safeAgent.toLowerCase() ||
            a.label.toLowerCase().replace(/[^a-z0-9]/g, '') ===
              safeAgent.toLowerCase().replace(/[^a-z0-9]/g, ''),
        );
        if (matchedAgent && matchedAgent.provider !== d.agent) {
          d.agent = matchedAgent.provider;
        }
      });

      if (
        delegations.every((d) => !agents.some((a) => a.provider === d.agent))
      ) {
        const attemptedAgents = delegations
          .map((d) => d.agent || 'unknown')
          .join(', ');
        return buildAnswer(
          decision.answer ||
            `Mình chưa thể xử lý yêu cầu này với các kết nối hiện có (Tên hệ thống mà AI đang cố gọi: "${attemptedAgents}" - Vui lòng đổi tên hoặc viết đúng tên). Vào Settings để kết nối agent phù hợp nhé.`,
          toolCalls,
        );
      }

      // delegateRound() không bao giờ throw — 1 delegation lỗi không làm mất
      // kết quả của delegation anh em đã chạy song song thành công.
      const results = await Promise.all(
        delegations.map((d) =>
          this.delegateRound(
            d,
            agents,
            data,
            prompt,
            replyMessageId,
            history,
            round,
          ),
        ),
      );

      const approvalNeeded = this.foldRoundResults(
        results,
        delegations,
        rounds,
        toolCalls,
      );
      if (approvalNeeded) {
        return this.checkpointPause.pauseForApproval(
          data,
          prompt,
          rounds,
          toolCalls,
          history,
          approvalNeeded,
        );
      }
    }

    this.logger.warn(
      `Supervisor chưa hội tụ sau ${ORCHESTRATION_CONSTANTS.MAX_SUPERVISOR_ROUNDS} vòng cho user ${userId}, tổng hợp lại kết quả đã có`,
    );
    const fallbackAccumulator = { text: '' };
    const finalAnswer = await runCancellable(
      replyMessageId,
      this.cancellation,
      (signal) =>
        this.supervisor.synthesize(
          prompt,
          rounds,
          buildOnToken(
            this.agentStream,
            userId,
            channelId,
            replyMessageId,
            channelType,
            fallbackAccumulator,
          ),
          signal,
        ),
      () => new TurnCancelledError(fallbackAccumulator.text || undefined),
    );
    return buildAnswer(finalAnswer, toolCalls);
  }

  /** Supervisor trả trùng agent trong cùng 1 vòng — giữ phần tử đầu tiên. */
  private dedupeByAgent(delegations: DelegationDto[]): DelegationDto[] {
    const seen = new Set<string>();
    return delegations.filter((d) => {
      if (seen.has(d.agent)) return false;
      seen.add(d.agent);
      return true;
    });
  }

  // Gộp kết quả 1 vòng delegate vào rounds/toolCalls (mutate tại chỗ). Trả về
  // delegation ĐẦU TIÊN cần duyệt (nếu có) — vẫn giữ lại toolCalls/rounds của
  // các delegation anh em đã xong trong CÙNG vòng, không để mất.
  private foldRoundResults(
    results: (DelegateRoundResult | ApprovalRequiredDelegateResult | null)[],
    delegations: DelegationDto[],
    rounds: SupervisorRoundDto[],
    toolCalls: ToolCallTraceDto[],
  ): ApprovalRequiredDelegateResult | null {
    let approvalNeeded: ApprovalRequiredDelegateResult | null = null;
    results.forEach((result, i) => {
      if (result && 'approvalRequired' in result) {
        toolCalls.push(...result.toolCalls);
        if (!approvalNeeded) approvalNeeded = result;
        return;
      }
      if (result) {
        rounds.push(result.round);
        toolCalls.push(...result.toolCalls);
      } else {
        rounds.push({
          agent: delegations[i].agent,
          task: delegations[i].task,
          result:
            'Agent này chưa khả dụng (chưa kết nối hoặc chưa có hạ tầng) — bỏ qua, không thực hiện được phần việc này.',
        });
      }
    });
    return approvalNeeded;
  }

  // Không bao giờ throw (trừ ApprovalRequiredError) — 1 ReactLoop lỗi (VD MCP
  // sập) trả về như round lỗi thay vì làm Promise.all() ở resolveAnswer()
  // reject cả loạt, mất kết quả của delegation anh em đã chạy song song.
  private async delegateRound(
    delegation: DelegationDto,
    agents: AvailableAgentDto[],
    data: IProcessAiTriggerJobData,
    originalPrompt: string,
    replyMessageId: string,
    history: ChatHistoryTurnDto[],
    round: number,
  ): Promise<DelegateRoundResult | ApprovalRequiredDelegateResult | null> {
    const { userId, channelId, workspaceId, channelType } = data;
    const targetAgent = agents.find((a) => a.provider === delegation.agent);

    if (!targetAgent) {
      this.logger.warn(
        `Supervisor delegated to unknown/unavailable agent "${delegation.agent}" for user ${userId}`,
      );
      return null;
    }

    const task = delegation.task || originalPrompt;
    try {
      const { answer, toolCalls } = await this.reactLoop.run({
        prompt: task,
        provider: targetAgent.provider,
        userId,
        channelId,
        workspaceId,
        messageId: replyMessageId,
        channelType,
        history,
        // Nhiều delegation có thể chạy SONG SONG trong CÙNG round (fan-out) —
        // khoá riêng theo (round, provider) để FE không gộp chung 1 chuỗi
        // (agent này resync() sẽ xoá mất phần agent kia đang stream nếu dùng
        // chung khoá). dedupeByAgent() đã đảm bảo không 2 delegation nào cùng
        // round trùng provider, nên khoá này luôn duy nhất trong cả turn.
        streamKey: `r${round}-${targetAgent.provider}`,
      });
      return {
        round: { agent: targetAgent.provider, task, result: answer },
        toolCalls,
      };
    } catch (error) {
      if (error instanceof ApprovalRequiredError) {
        return {
          approvalRequired: error.pendingTool,
          task,
          toolCalls: error.toolCalls,
        };
      }
      this.logger.error(
        `ReactLoop failed for agent "${targetAgent.provider}": ${(error as Error).message}`,
        (error as Error).stack,
      );
      return {
        round: {
          agent: targetAgent.provider,
          task,
          result: describeExternalServiceError(error),
        },
        toolCalls: [],
      };
    }
  }
}
