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
import { capToolResultSize } from '../executor/tool-result-size-cap.util';
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

  // Entry point cho turn MỚI — chuẩn bị prompt/agents/history rồi giao hết
  // cho continueRounds() (Plan-and-Execute, xem bên dưới).
  async resolveAnswer(
    data: IProcessAiTriggerJobData,
    replyMessageId: string,
  ): Promise<AnswerResult> {
    const { userId, channelId, messageId } = data;
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

    return this.continueRounds(
      data,
      replyMessageId,
      prompt,
      agents,
      history,
      [],
      [],
    );
  }

  // Tách riêng khỏi resolveAnswer() để ApprovalFlowService dùng lại được: sau
  // khi 1 hành động rủi ro được duyệt + thực thi thật, phần việc CÒN LẠI của
  // câu hỏi gốc phải quay lại ĐÚNG vòng lặp Supervisor này (rounds đã có sẵn
  // kết quả hành động vừa duyệt) — thay vì resume cứng trên CÙNG 1 provider
  // vừa dùng. Bug cũ: agent A không nhìn thấy tool của agent B (mcpClient.getTools
  // chỉ trả tool của ĐÚNG 1 provider), nên nếu phần còn lại cần agent khác thì
  // bị ép hallucinate 1 tool sai trên agent A. Nhờ quay lại đây, Supervisor tự
  // quyết định agent phù hợp cho phần còn lại — và chuỗi duyệt-nhiều-lần cũng
  // tự động hoạt động (delegateRound() gặp ApprovalRequiredError ở BẤT KỲ vòng
  // nào, kể cả vòng vừa resume, đều pause bình thường qua
  // CheckpointPauseService — không cần logic đặc biệt nào khác ở tầng gọi).
  //
  // Plan-and-Execute (xem accuracy.md) — KHÔNG còn hỏi lại Supervisor "làm gì
  // tiếp" mỗi bước (decide() cũ). Thay vào đó: (1) supervisor.plan() gọi 1 LẦN,
  // trả về TOÀN BỘ các bước còn lại (`steps`); (2) thực thi TỪNG bước tuần tự
  // qua delegateRound() (v1: KHÔNG fan-out song song trong 1 lần plan nữa — đổi
  // lấy sự đúng đắn của thứ tự/agent, đánh đổi hiệu năng cho case nhiều agent
  // ĐỘC LẬP thật sự — để research tối ưu sau); (3) sau MỖI bước, gọi
  // supervisor.evaluate() (câu hỏi hẹp, rẻ hơn plan()) để quyết định
  // 'continue' (bám kế hoạch cũ), 're-plan' (gọi lại plan() với rounds mới),
  // hay 'done' (đủ dữ liệu, dừng sớm không cần chạy hết steps còn lại).
  async continueRounds(
    data: IProcessAiTriggerJobData,
    replyMessageId: string,
    prompt: string,
    agents: AvailableAgentDto[],
    history: ChatHistoryTurnDto[],
    rounds: SupervisorRoundDto[],
    toolCalls: ToolCallTraceDto[],
  ): Promise<AnswerResult> {
    const { userId, channelId, channelType } = data;

    // QUAN TRỌNG: KHÔNG bắt đầu lại từ round=0 — `rounds` có thể đã có sẵn kết
    // quả từ (các) lần resume TRƯỚC (approveCheckpoint gọi lại continueRounds()
    // sau mỗi lần duyệt). Nếu reset về 0 mỗi lần, mỗi lượt duyệt lại được cấp
    // NGUYÊN 1 ngân sách MAX_SUPERVISOR_ROUNDS mới — Supervisor cứ delegate sai/
    // lặp lại là pause-resume vô hạn (không có trần tổng nào cho cả turn), phải
    // tự bấm Stop mới dừng được. `rounds.length` dùng làm điểm bắt đầu để CẢ
    // turn (kể cả qua nhiều lần duyệt) chỉ tiêu tốn tối đa MAX_SUPERVISOR_ROUNDS
    // bước thực thi, dù có re-plan bao nhiêu lần đi nữa.
    let round = rounds.length;
    let steps: DelegationDto[] = [];
    let needsPlan = true;

    while (round < ORCHESTRATION_CONSTANTS.MAX_SUPERVISOR_ROUNDS) {
      // plan()/evaluate() dùng generateStructured() (không stream) nên không
      // bọc được AbortSignal như ReactLoop/synthesize() — kiểm tra cờ huỷ GIỮA
      // các bước là đủ, vì đây vốn đã là các lệnh gọi ngắn (JSON, không phải
      // câu trả lời dài).
      if (await this.cancellation.isCancelled(replyMessageId)) {
        // Chưa có gì đang stream ở đúng thời điểm này (đang giữa 2 bước) —
        // giữ lại kết quả GẦN NHẤT đã có (nếu có) làm nội dung lưu, thay vì
        // xoá sạch về 1 câu thông báo chung chung.
        throw new TurnCancelledError(
          rounds.length > 0 ? rounds[rounds.length - 1].result : undefined,
        );
      }

      if (needsPlan) {
        const plan = await this.supervisor.plan(
          prompt,
          agents,
          rounds,
          history,
        );

        if (plan.action === 'respond') {
          return this.finalizeAnswer(
            data,
            replyMessageId,
            prompt,
            rounds,
            toolCalls,
            plan.answer,
          );
        }

        steps = plan.steps ?? [];

        // Khắc phục lỗi LLM trả về label (tên agent) thay vì provider ID (đặc biệt với Dynamic Agent có ID là UUID)
        steps.forEach((s) => {
          const safeAgent = s.agent || '';
          const matchedAgent = agents.find(
            (a) =>
              a.provider === safeAgent ||
              a.label.toLowerCase() === safeAgent.toLowerCase() ||
              a.label.toLowerCase().replace(/[^a-z0-9]/g, '') ===
                safeAgent.toLowerCase().replace(/[^a-z0-9]/g, ''),
          );
          if (matchedAgent && matchedAgent.provider !== s.agent) {
            s.agent = matchedAgent.provider;
          }
        });

        if (steps.every((s) => !agents.some((a) => a.provider === s.agent))) {
          const attemptedAgents = steps
            .map((s) => s.agent || 'unknown')
            .join(', ');
          return buildAnswer(
            plan.answer ||
              `Mình chưa thể xử lý yêu cầu này với các kết nối hiện có (Tên hệ thống mà AI đang cố gọi: "${attemptedAgents}" - Vui lòng đổi tên hoặc viết đúng tên). Vào Settings để kết nối agent phù hợp nhé.`,
            toolCalls,
          );
        }
        needsPlan = false;
      }

      if (steps.length === 0) {
        // plan() trả "plan" nhưng steps rỗng/toàn agent không hợp lệ sau khi
        // lọc — coi như xong với những gì đã có (giống hệt nhánh "done"),
        // KHÔNG rơi xuống fallback "chưa hội tụ" (đó là dành riêng cho việc
        // hết NGÂN SÁCH vòng, không phải hết việc trong kế hoạch).
        return this.finalizeAnswer(
          data,
          replyMessageId,
          prompt,
          rounds,
          toolCalls,
        );
      }

      const step = steps.shift()!;
      // delegateRound() không bao giờ throw (trừ approvalRequired) — 1 bước lỗi
      // ghi lại thành round lỗi, không làm sập cả turn.
      const result = await this.delegateRound(
        step,
        agents,
        data,
        prompt,
        replyMessageId,
        history,
        round,
        rounds,
      );
      round++;

      if (result && 'approvalRequired' in result) {
        toolCalls.push(...result.toolCalls);
        return this.checkpointPause.pauseForApproval(
          data,
          prompt,
          rounds,
          toolCalls,
          history,
          result,
        );
      }

      const completedRound: SupervisorRoundDto = result
        ? result.round
        : {
            agent: step.agent,
            task: step.task,
            result:
              'Agent này chưa khả dụng (chưa kết nối hoặc chưa có hạ tầng) — bỏ qua, không thực hiện được phần việc này.',
          };
      rounds.push(completedRound);
      if (result) toolCalls.push(...result.toolCalls);

      const verdict = await this.supervisor.evaluate(
        prompt,
        completedRound,
        steps,
      );
      if (verdict.verdict === 'done') {
        return this.finalizeAnswer(
          data,
          replyMessageId,
          prompt,
          rounds,
          toolCalls,
        );
      }
      if (verdict.verdict === 're-plan') {
        needsPlan = true;
        steps = [];
      }
      // 'continue' — vòng while lặp lại, needsPlan vẫn false, tiếp tục lấy
      // bước kế trong `steps` mà KHÔNG gọi lại plan().
    }

    this.logger.warn(
      `Supervisor chưa hội tụ sau ${ORCHESTRATION_CONSTANTS.MAX_SUPERVISOR_ROUNDS} bước cho user ${userId}, tổng hợp lại kết quả đã có`,
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

  // Dùng chung cho 3 nơi kết thúc "sạch" (không phải hết ngân sách vòng):
  // plan().action==='respond', evaluate().verdict==='done', và plan() trả về
  // rỗng/toàn agent không hợp lệ. Nguyên tắc "stream = save":
  // - rounds.length === 1: đúng 1 bước đã có kết quả — dùng thẳng kết quả ĐÃ
  //   STREAM của nó (rounds[0].result), bỏ qua answerHint (plan()/evaluate()
  //   không stream, paraphrase sẽ khác nội dung đã hiện ra).
  // - rounds.length > 1: cần tổng hợp thật nhiều bước — gọi lại synthesize()
  //   (CÓ stream) để nội dung stream ra và nội dung lưu luôn khớp nhau, thay
  //   vì dùng answerHint chưa từng stream.
  // - rounds.length === 0: chỉ xảy ra ở nhánh "respond" ngay từ đầu (chưa từng
  //   lập kế hoạch) — không có gì để stream lại, chấp nhận không stream cho
  //   case này (ngoại lệ đã biết, không phải sót).
  private async finalizeAnswer(
    data: IProcessAiTriggerJobData,
    replyMessageId: string,
    prompt: string,
    rounds: SupervisorRoundDto[],
    toolCalls: ToolCallTraceDto[],
    answerHint?: string,
  ): Promise<AnswerResult> {
    const { userId, channelId, channelType } = data;

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
      answerHint || 'Xin lỗi, mình chưa có câu trả lời phù hợp.',
      toolCalls,
    );
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
    roundsSoFar: SupervisorRoundDto[],
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
    // Agent thực thi bước này CHỈ thấy đúng `task` (câu Supervisor viết TRƯỚC
    // KHI bước nào chạy) — không tự nhiên biết dữ liệu THẬT các bước trước đã
    // thu thập được (VD số liệu SQL cần ghi vào Google Docs ở bước sau). Ghép
    // thêm dữ liệu thật đó vào đây — nguyên tắc giống hệt buildPrompt() của
    // Supervisor, chỉ khác là dành cho sub-agent thực thi, không phải Supervisor.
    // Cap bằng capToolResultSize để không lặp lại sự cố "context quá to → LLM
    // timeout" (xem accuracy.md, mục B).
    const promptWithContext =
      roundsSoFar.length > 0
        ? `${task}\n\nDữ liệu THẬT đã thu thập được từ (các) bước trước trong CÙNG yêu cầu này (PHẢI dùng ĐÚNG NGUYÊN VĂN, không tự bịa/diễn giải lại số liệu):\n${capToolResultSize(
            roundsSoFar
              .map(
                (r, i) =>
                  `${i + 1}. Agent "${r.agent}" (yêu cầu: "${r.task}") → kết quả: ${r.result}`,
              )
              .join('\n'),
          )}`
        : task;
    try {
      const { answer, toolCalls } = await this.reactLoop.run({
        prompt: promptWithContext,
        provider: targetAgent.provider,
        userId,
        channelId,
        workspaceId,
        messageId: replyMessageId,
        channelType,
        history,
        // Mỗi bước trong plan chạy TUẦN TỰ (không còn fan-out song song, xem
        // continueRounds()) nhưng vẫn khoá riêng theo (round, provider) — round
        // tăng dần đều mỗi bước nên khoá này luôn duy nhất trong cả turn, kể cả
        // khi cùng 1 provider xuất hiện lại ở bước sau (VD đọc rồi ghi).
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
