import { Injectable, Logger } from '@nestjs/common';
import { IProcessAiTriggerJobData } from '@slack/queue';
import { ORCHESTRATION_CONSTANTS } from '@slack/constants';
import { MessageClientService } from '../message-client.service';
import { ReactLoopService } from '../llm/react-loop.service';
import {
  AgentRankingCache,
  SupervisorService,
} from '../llm/supervisor.service';
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
  capRoundResults,
  resolveDataCharBudget,
} from '../executor/tool-result-size-cap.util';
import { hasPendingActionStep } from '../common/pending-action-step.util';
import {
  AnswerResult,
  ApprovalRequiredDelegateResult,
  DelegateRoundResult,
  buildAnswer,
} from './orchestration-answer.types';

// Giai đoạn Accuracy v2, mục 3 — guardrail rẻ ở planning stage. Nhãn agent quá
// ngắn (VD dynamic provider đặt tên chung chung "API", "Data") dễ khớp nhầm
// vào bất kỳ câu task nào — bỏ qua các nhãn dưới ngưỡng này để giảm false-positive.
const MIN_AGENT_LABEL_LENGTH_FOR_MISMATCH_CHECK = 3;

// accuracy_problem.md — 2 marker để nhận lại round "KHÔNG TIẾN TRIỂN" (guardrail
// chặn sớm HOẶC evaluate() trả 're-plan') trong mảng `rounds` khi resume từ
// checkpoint — `rounds` lưu CHUNG mọi loại round, không có field riêng phân
// biệt. Dùng lại đúng 2 tiền tố này ở nơi tạo note (bên dưới) và nơi lọc lại
// (continueRounds()) — thiếu marker cho 're-plan' sẽ làm mất dấu vết non-progress
// đã xảy ra TRƯỚC 1 lần pause HITL, tái diễn bug "pause→resume vô hạn" mà chính
// ngân sách này sinh ra để chặn.
const GUARDRAIL_BLOCKED_MARKER = 'Bỏ qua bước này';
const REPLAN_MARKER = '[re-plan]';

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
    // accuracy_problem.md mục 1 — set bởi ApprovalFlowService khi resume sau
    // khi user vừa trả lời 1 clarification (đã biết CHÍNH XÁC agent nào đúng)
    // — bỏ qua plan() cho bước ĐẦU TIÊN này, thực thi thẳng, không re-check
    // ambiguity (đã hỏi rồi, không hỏi lại vòng 2 cho CÙNG 1 bước).
    forcedStep?: DelegationDto,
    // accuracy_problem.md mục 9.2 — set bởi ApprovalFlowService khi resume sau
    // khi 1 hành động vừa được duyệt + thực thi thật: các bước B, C... CÒN LẠI
    // của kế hoạch GỐC (đã lưu trong checkpoint lúc pause) — bỏ qua plan(),
    // dùng lại ĐÚNG kế hoạch cũ thay vì lập lại từ đầu (trước đây KHÔNG lưu gì
    // cả, buộc phải plan() lại toàn bộ, không có gì đảm bảo bản mới không bỏ
    // sót B/C).
    remainingSteps?: DelegationDto[],
  ): Promise<AnswerResult> {
    const { userId, channelId, channelType } = data;

    // accuracy_problem.md — TÁCH 2 ngân sách, trước đây dùng CHUNG 1 biến `round`
    // (mỗi bước thật LẪN mỗi lần guardrail chặn LẪN mỗi lần re-plan đều trừ vào
    // cùng 1 con số): 1 chuỗi 4-5 bước HỢP LỆ chỉ cần 1 lần guardrail chặn/re-plan
    // là gần như hết sạch ngân sách, dù task hoàn toàn giải được.
    // - realStepsRun: số bước THẬT đã chạy qua delegateRound() (thành công hay
    //   lỗi đều tính) — task hợp lệ nhiều bước cần room LỚN, không nên bị bóp bởi
    //   lưới chặn vòng lặp bệnh lý.
    // - nonProgressRounds: số lần "không tiến triển" — guardrail chặn sớm (mục 3)
    //   HOẶC evaluate() trả 're-plan' (bước vừa chạy không đạt kỳ vọng). Đây MỚI
    //   là tín hiệu thật của vòng lặp bệnh lý (Supervisor cứ thử mà không tiến
    //   triển) — giữ nguyên ngưỡng CHẶT MAX_SUPERVISOR_ROUNDS như cũ.
    //
    // QUAN TRỌNG: KHÔNG bắt đầu lại từ 0 — `rounds` có thể đã có sẵn kết quả từ
    // (các) lần resume TRƯỚC (approveCheckpoint gọi lại continueRounds() sau mỗi
    // lần duyệt). `rounds` lưu CHUNG mọi loại round, không có field riêng phân
    // biệt — tách lại bằng GUARDRAIL_BLOCKED_MARKER/REPLAN_MARKER (do chính code
    // này tự gắn khi tạo note, xem bên dưới) thay vì cần đổi schema/migration
    // checkpoint.
    let nonProgressRounds = rounds.filter(
      (r) =>
        r.result.startsWith(GUARDRAIL_BLOCKED_MARKER) ||
        r.result.startsWith(REPLAN_MARKER),
    ).length;
    let realStepsRun = rounds.length - nonProgressRounds;
    // forcedStep (resume sau clarification) đứng trước, các bước B/C được
    // phục hồi (nếu có) nối tiếp NGAY SAU nó — forcedStep CHƯA từng chạy (sẽ
    // chạy qua delegateRound() bình thường trong vòng while bên dưới), khác
    // hẳn trường hợp remainingSteps-không-forcedStep (resume sau approval) nơi
    // round tương ứng đã chạy XONG rồi.
    let steps: DelegationDto[] = forcedStep
      ? [forcedStep, ...(remainingSteps ?? [])]
      : (remainingSteps ?? []);
    let needsPlan = !forcedStep && remainingSteps === undefined;
    // accuracy_problem.md mục 9.4 — sống ĐÚNG bằng phạm vi lần gọi
    // continueRounds() này (turn hiện tại) — plan() có thể bị gọi lại nhiều
    // lần trong lúc này (re-plan) với CÙNG prompt/agents, khỏi build lại
    // embedding ranking agent mỗi lần.
    const agentRankingCache: AgentRankingCache = {};

    // accuracy_problem.md mục 9.2 — round VỪA được duyệt+thực thi thật
    // (approveCheckpoint() tự chạy tool đó TRỰC TIẾP, KHÔNG qua delegateRound())
    // chưa từng đi qua evaluate() — đánh giá nó NGAY BÂY GIỜ, giống hệt cách
    // MỌI bước khác được đánh giá ngay sau khi chạy xong (xem trong vòng while
    // bên dưới), tránh mất tín hiệu "bước vừa duyệt có ổn không, còn cần làm
    // tiếp B/C không" chỉ vì nó tới từ 1 đường vòng khác (HITL) thay vì
    // delegateRound() trực tiếp. CHỈ áp dụng cho resume sau APPROVAL (không có
    // forcedStep) — resume sau CLARIFICATION có forcedStep CHƯA từng chạy,
    // không có gì "vừa xong" để đánh giá ở đây, nó sẽ tự đi qua evaluate() sau
    // khi delegateRound() chạy nó trong vòng while như 1 bước bình thường.
    if (!forcedStep && remainingSteps !== undefined && rounds.length > 0) {
      const lastRound = rounds[rounds.length - 1];
      const outcome = await this.runEvaluateAndDecide(prompt, lastRound, steps);
      if (outcome === 'finalize') {
        return this.finalizeAnswer(
          data,
          replyMessageId,
          prompt,
          rounds,
          toolCalls,
        );
      }
      if (outcome === 'replan') {
        nonProgressRounds++;
        rounds.push({
          agent: lastRound.agent,
          task: lastRound.task,
          result: `${REPLAN_MARKER} evaluate() cho rằng bước vừa xong không đạt kỳ vọng, đã lập lại kế hoạch.`,
        });
        needsPlan = true;
        steps = [];
      }
      // 'continue' — giữ nguyên `steps`/`needsPlan` đã set ở trên, vào while
      // loop bình thường để tiếp tục đúng kế hoạch cũ.
    }

    while (
      realStepsRun < ORCHESTRATION_CONSTANTS.MAX_REAL_STEPS_PER_TURN &&
      nonProgressRounds < ORCHESTRATION_CONSTANTS.MAX_SUPERVISOR_ROUNDS
    ) {
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
          agentRankingCache,
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
        // accuracy_problem.md mục 1 — chỉ hỏi lại user khi cụm mơ hồ TRÙNG với
        // bước ĐẦU TIÊN sắp thực thi (agent vừa fix nhãn ở trên). Gated sau
        // ENABLE_CLARIFICATION_HITL — mặc định TẮT (chưa đủ dữ liệu tần suất
        // từ mục 1 bước 1 để biết có đáng bật hay không).
        if (
          process.env.ENABLE_CLARIFICATION_HITL === 'true' &&
          plan.ambiguousCandidates?.some((c) => c.provider === steps[0]?.agent)
        ) {
          return this.checkpointPause.pauseForClarification(
            data,
            prompt,
            rounds,
            toolCalls,
            history,
            steps[0].task,
            plan.ambiguousCandidates,
            // accuracy_problem.md mục 9.2 — `steps` ở đây CHƯA bị shift(), nên
            // steps[0] chính là bước mơ hồ đang dừng lại hỏi; phần còn lại
            // (B, C...) lưu kèm để resolveClarificationCheckpoint() phục hồi
            // đúng kế hoạch gốc sau khi user chọn xong.
            steps.slice(1),
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

      // Giai đoạn Accuracy v2, mục 3 — guardrail RẺ (không LLM) TRƯỚC khi thực
      // thi: chặn sớm 1 lựa chọn agent rành rành sai, thay vì đợi evaluate()
      // phát hiện SAU KHI đã tốn 1 lượt reactLoop.run() + 1 lượt LLM evaluate().
      const misroutedTo = this.findLikelyMisroutedAgent(step, agents);
      if (misroutedTo) {
        this.logger.warn(
          `Guardrail: bước chọn agent "${step.agent}" nhưng task nhắc rõ hệ thống "${misroutedTo.label}" (provider "${misroutedTo.provider}") — nghi ngờ chọn sai, re-plan sớm thay vì thực thi mù.`,
        );
        // Đánh đổi nhỏ đã biết: push note này vào CHUNG `rounds` với kết quả
        // thật (kênh duy nhất plan() đọc lại được) làm rounds.length tăng lên
        // ngay cả khi CHƯA có kết quả thật nào — nếu sau đó chỉ có ĐÚNG 1 bước
        // thật thành công, finalizeAnswer() sẽ thấy rounds.length > 1 và gọi
        // synthesize() (tốn 1 lượt LLM) thay vì trả thẳng rounds[0].result như
        // bình thường. Chấp nhận được vì: (a) guardrail tự nó không tốn LLM
        // call nào (rẻ hơn hẳn để evaluate() bắt lỗi này SAU khi đã chạy thật),
        // (b) synthesize() vẫn cho ra câu trả lời đúng, chỉ là tốn thêm đúng 1
        // lượt LLM cho trường hợp phục hồi ngay sau khi bị chặn.
        rounds.push({
          agent: step.agent,
          task: step.task,
          result: `${GUARDRAIL_BLOCKED_MARKER} — kế hoạch chọn hệ thống "${step.agent}" nhưng yêu cầu nhắc rõ tới hệ thống "${misroutedTo.label}" (đã kết nối, provider "${misroutedTo.provider}") — có khả năng chọn sai agent, cần lập lại kế hoạch.`,
        });
        nonProgressRounds++;
        needsPlan = true;
        steps = [];
        continue;
      }

      // delegateRound() không bao giờ throw (trừ approvalRequired) — 1 bước lỗi
      // ghi lại thành round lỗi, không làm sập cả turn.
      const result = await this.delegateRound(
        step,
        agents,
        data,
        prompt,
        replyMessageId,
        history,
        realStepsRun,
        rounds,
      );
      realStepsRun++;

      if (result && 'approvalRequired' in result) {
        toolCalls.push(...result.toolCalls);
        // accuracy_problem.md mục 9.5 — 1 lượt LLM có thể xin gọi NHIỀU tool
        // cùng lúc (turn.toolCalls trong ReactLoopService); nếu tool ĐẦU an
        // toàn đã chạy xong thật rồi tool SAU mới bị Risk Gate chặn, dữ liệu
        // tool đầu đó phải được giữ lại NGAY ĐÂY (đưa vào `rounds`) — nếu
        // không, nó chỉ tồn tại trong `toolCalls` (trace hiện UI, KHÔNG được
        // lưu vào checkpoint) và biến mất hoàn toàn sau khi duyệt+resume
        // (approveCheckpoint() chỉ tạo lại round từ ĐÚNG kết quả tool vừa
        // duyệt, không biết gì về tool đã chạy trước đó).
        const preApprovalRound = this.buildPreApprovalRound(
          step,
          result.toolCalls,
        );
        if (preApprovalRound) rounds.push(preApprovalRound);
        // accuracy_problem.md mục 9.2 — `steps` tại đây CHÍNH LÀ các bước còn
        // lại của kế hoạch gốc (đã shift() bước gây pause ra khỏi mảng ở trên)
        // — lưu lại để resume ĐÚNG theo kế hoạch cũ, không phải lập lại từ đầu.
        return this.checkpointPause.pauseForApproval(
          data,
          prompt,
          rounds,
          toolCalls,
          history,
          result,
          steps,
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

      const outcome = await this.runEvaluateAndDecide(
        prompt,
        completedRound,
        steps,
      );
      if (outcome === 'finalize') {
        return this.finalizeAnswer(
          data,
          replyMessageId,
          prompt,
          rounds,
          toolCalls,
        );
      }
      if (outcome === 'replan') {
        nonProgressRounds++;
        // Đẩy thêm 1 note "vô hình" — CÙNG cơ chế guardrail-block đã dùng
        // (đánh đổi đã biết: lọt vào input của synthesize() sau này) — không
        // có chỗ nào khác để giữ lại tín hiệu "bước này bị đánh giá không đạt"
        // qua 1 lần pause/resume HITL, vì `rounds` là kênh DUY NHẤT sống sót
        // qua checkpoint.
        rounds.push({
          agent: completedRound.agent,
          task: completedRound.task,
          result: `${REPLAN_MARKER} evaluate() cho rằng bước vừa xong không đạt kỳ vọng, đã lập lại kế hoạch.`,
        });
        needsPlan = true;
        steps = [];
      }
      // 'continue' — vòng while lặp lại, needsPlan vẫn false, tiếp tục lấy
      // bước kế trong `steps` mà KHÔNG gọi lại plan().
    }

    this.logger.warn(
      `Supervisor chưa hội tụ (realSteps=${realStepsRun}/${ORCHESTRATION_CONSTANTS.MAX_REAL_STEPS_PER_TURN}, nonProgress=${nonProgressRounds}/${ORCHESTRATION_CONSTANTS.MAX_SUPERVISOR_ROUNDS}) cho user ${userId}, tổng hợp lại kết quả đã có`,
    );
    await this.agentStream
      .emitStep(
        { userId, channelId, messageId: replyMessageId, channelType },
        {
          type: 'step_start',
          label: 'Tổng hợp câu trả lời',
          kind: 'synthesize',
        },
      )
      .catch(() => {});
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
      await this.agentStream
        .emitStep(
          { userId, channelId, messageId: replyMessageId, channelType },
          {
            type: 'step_start',
            label: 'Tổng hợp câu trả lời',
            kind: 'synthesize',
          },
        )
        .catch(() => {});
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

  // accuracy_problem.md mục 9.2 — dùng CHUNG cho 2 nơi: (a) sau khi
  // delegateRound() 1 bước bình thường trong vòng lặp chính, (b) ngay khi
  // resume sau khi 1 hành động vừa được duyệt+thực thi thật
  // (ApprovalFlowService.approveCheckpoint() tự chạy tool đó TRỰC TIẾP, KHÔNG
  // qua delegateRound() — round đó vì vậy CHƯA từng đi qua evaluate(), phải
  // đánh giá NGAY khi resume, y hệt cách mọi bước khác được đánh giá).
  private async runEvaluateAndDecide(
    prompt: string,
    completedRound: SupervisorRoundDto,
    remainingSteps: DelegationDto[],
  ): Promise<'finalize' | 'replan' | 'continue'> {
    const verdict = await this.supervisor.evaluate(
      prompt,
      completedRound,
      remainingSteps,
    );
    if (verdict.verdict === 'done') {
      if (!hasPendingActionStep(remainingSteps)) {
        return 'finalize';
      }
      // Lưới an toàn rule-based (mục 6/11/14, xem pending-action-step.util.ts)
      // — bác bỏ "done", coi như 'continue'. Chạy ĐỘC LẬP với evaluate(), kể
      // cả khi SupervisorService.evaluate() đã chặn "done" khỏi schema (mục
      // 14) — giữ lại làm phòng thủ cuối phòng model/provider không tuân
      // schema tuyệt đối.
      this.logger.warn(
        `evaluate() trả 'done' nhưng còn bước HÀNH ĐỘNG/KIỂM TRA chưa chạy (${remainingSteps.map((s) => s.task).join('; ')}) — bác bỏ 'done', tiếp tục chạy nốt kế hoạch.`,
      );
      return 'continue';
    }
    if (verdict.verdict === 're-plan') {
      return 'replan';
    }
    return 'continue';
  }

  // accuracy_problem.md mục 9.5 — dữ liệu tool AN TOÀN chạy TRƯỚC tool bị
  // Risk Gate chặn trong CÙNG 1 lượt LLM (ReactLoopService cho phép model xin
  // gọi nhiều tool cùng lúc) — giữ lại thành 1 round RIÊNG trước khi pause,
  // để nó sống sót qua checkpoint/resume thay vì chỉ tồn tại trong `toolCalls`
  // (trace hiện UI, không được lưu vào checkpoint DB). `null` nếu không có
  // tool nào chạy THÀNH CÔNG trước đó (VD tool bị chặn là tool ĐẦU TIÊN của
  // lượt — trường hợp phổ biến nhất, không cần thêm round nào).
  private buildPreApprovalRound(
    step: DelegationDto,
    toolCallsBeforeBlock: ToolCallTraceDto[],
  ): SupervisorRoundDto | null {
    const successful = toolCallsBeforeBlock.filter(
      (tc) => tc.status === 'success',
    );
    if (successful.length === 0) return null;

    const result = successful
      .map((tc) => `${tc.tool}: ${tc.resultPreview ?? '(không có nội dung)'}`)
      .join('\n');
    return {
      agent: step.agent,
      task: `${step.task} (dữ liệu đã thu thập được TRƯỚC KHI cần duyệt 1 hành động khác trong cùng bước này)`,
      result,
    };
  }

  // Giai đoạn Accuracy v2, mục 3 — KHÔNG dùng "task có khớp từ khoá với mô tả
  // agent ĐƯỢC CHỌN" (như dự tính ban đầu ở accuracy.v2.md): rủi ro false-positive
  // cao, vì task và mô tả của agent ĐÚNG cũng thường không chung từ khoá nào
  // (VD task "chèn vào bảng users" vs agent sql_server mô tả "Truy vấn schema
  // và dữ liệu trên SQL Server" — không share từ khoá dù đây là lựa chọn ĐÚNG).
  // Naive keyword-overlap sẽ tự báo động nhầm cho phần lớn plan đúng.
  //
  // Đổi hướng an toàn hơn: chỉ nghi ngờ khi `task` nhắc rõ TÊN (label) của 1
  // agent KHÁC đã kết nối, mà KHÔNG hề nhắc tên agent đang được chọn — tín
  // hiệu hiếm khi sai (1 task mô tả đúng việc của agent X hiếm khi tự nhiên
  // nhắc tên 1 agent Y khác).
  private findLikelyMisroutedAgent(
    step: DelegationDto,
    agents: AvailableAgentDto[],
  ): AvailableAgentDto | null {
    const chosenAgent = agents.find((a) => a.provider === step.agent);
    // Agent không tồn tại trong danh sách — đã có nhánh xử lý riêng ở
    // delegateRound() (fallback "chưa khả dụng"), không phải việc của guardrail này.
    if (!chosenAgent) return null;

    const taskLower = step.task.toLowerCase();
    if (taskLower.includes(chosenAgent.label.toLowerCase())) return null;

    return (
      agents.find(
        (a) =>
          a.provider !== step.agent &&
          a.label.length >= MIN_AGENT_LABEL_LENGTH_FOR_MISMATCH_CHECK &&
          taskLower.includes(a.label.toLowerCase()),
      ) ?? null
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
    // Cap TỪNG round riêng (capRoundResults) để không lặp lại sự cố "context
    // quá to → LLM timeout" (xem accuracy.md, mục B) — KHÔNG nối rồi cap cả
    // khối, vì cách đó có thể xoá sổ hoàn toàn 1 round Ở GIỮA khi tổng dữ
    // liệu vượt cap (accuracy_problem.md). ReactLoop luôn dùng DEFAULT_REACT_MODEL
    // (dto.model không có caller nào override) — ngân sách tính THEO ĐÚNG model
    // đó (resolveDataCharBudget), không phải 1 hằng số cố định không liên quan.
    const reactModelId =
      process.env.DEFAULT_REACT_MODEL ??
      ORCHESTRATION_CONSTANTS.DEFAULT_REACT_MODEL;
    // Bug thật phát hiện qua review — GUARDRAIL_BLOCKED_MARKER/REPLAN_MARKER
    // là ghi chú NỘI BỘ cho SUPERVISOR (plan()/synthesize() cần biết "vừa có
    // 1 lần không tiến triển" để tránh lặp lại sai lầm — xem mục 3/4), KHÔNG
    // phải dữ liệu thật của bất kỳ hệ thống nào. Sub-agent thực thi bước này
    // không có lý do gì cần biết chuyện nội bộ đó — nếu không lọc ra, nó sẽ
    // nhận nguyên văn "[re-plan] evaluate() cho rằng bước vừa xong không đạt
    // kỳ vọng..." như thể đây là 1 kết quả THẬT "PHẢI dùng ĐÚNG NGUYÊN VĂN",
    // gây nhiễu/sai lệch ngữ cảnh cho chính bước đang thực thi.
    const realRoundsSoFar = roundsSoFar.filter(
      (r) =>
        !r.result.startsWith(GUARDRAIL_BLOCKED_MARKER) &&
        !r.result.startsWith(REPLAN_MARKER),
    );
    const promptWithContext =
      realRoundsSoFar.length > 0
        ? `${task}\n\nDữ liệu THẬT đã thu thập được từ (các) bước trước trong CÙNG yêu cầu này (PHẢI dùng ĐÚNG NGUYÊN VĂN, không tự bịa/diễn giải lại số liệu):\n${capRoundResults(
            realRoundsSoFar,
            resolveDataCharBudget(reactModelId),
          )
            .map(
              (r, i) =>
                `${i + 1}. Agent "${r.agent}" (yêu cầu: "${r.task}") → kết quả: ${r.result}`,
            )
            .join('\n')}`
        : task;
    // Mỗi bước trong plan chạy TUẦN TỰ (không còn fan-out song song, xem
    // continueRounds()) nhưng vẫn khoá riêng theo (round, provider) — round
    // tăng dần đều mỗi bước nên khoá này luôn duy nhất trong cả turn, kể cả
    // khi cùng 1 provider xuất hiện lại ở bước sau (VD đọc rồi ghi).
    const streamKey = `r${round}-${targetAgent.provider}`;
    // FE trace UI — nhãn NGƯỜI ĐỌC ĐƯỢC cho nhóm event sắp phát dưới cùng
    // `streamKey` này, phát TRƯỚC reactLoop.run() để FE có tiêu đề ngay khi
    // bước bắt đầu, không phải đợi tool_call đầu tiên.
    await this.agentStream
      .emitStep(
        {
          userId,
          channelId,
          messageId: replyMessageId,
          channelType,
          streamKey,
        },
        { type: 'step_start', label: `${targetAgent.label}: ${task}` },
      )
      .catch(() => {});
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
        streamKey,
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
