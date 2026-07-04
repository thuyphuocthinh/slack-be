import { Processor } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { RpcException } from '@nestjs/microservices';
import { traceable } from 'langsmith/traceable';
import {
  BaseProcessor,
  EJobName,
  EQueueName,
  IProcessAiTriggerJobData,
} from '@slack/queue';
import { ORCHESTRATION_CONSTANTS, ORCHESTRATION_ERROR } from '@slack/constants';
import { extractTextFromMcpResult } from '@slack/common';
import { MessageClientService } from '../message-client.service';
import { ReactLoopService } from '../llm/react-loop.service';
import { SupervisorService } from '../llm/supervisor.service';
import { McpClientService } from '../mcp/mcp-client.service';
import {
  AvailableAgentDto,
  DelegationDto,
  SupervisorRoundDto,
} from '../dto/supervisor.dto';
import { ToolCallTraceDto } from '../dto/react-loop.dto';
import { ChatHistoryTurnDto } from '../dto/message-client.dto';
import { AgentStreamService } from '../socket/agent-stream.service';
import { describeExternalServiceError } from '../llm/external-service-error.util';
import { ApprovalRequiredError } from '../llm/approval-required.error';
import {
  extractWriteQueryPreviewTarget,
  parseSingleCountResult,
} from '../llm/write-query-preview.util';
import { CheckpointService } from '../checkpoint/checkpoint.service';
import {
  OrchestrationCheckpointStatus,
  PendingToolCall,
} from '../entity/orchestration-checkpoint.entity';
import { ResolveApprovalRequestDto } from '../dto/orchestration.dto';

interface AnswerResult {
  // Luôn là string — content dạng object (approval_request) đi vào 1 message
  // MỚI qua createMessage() (Step 3), không phải update lại message này.
  content: string;
  toolCalls?: ToolCallTraceDto[];
}

interface DelegateRoundResult {
  round: SupervisorRoundDto;
  toolCalls: ToolCallTraceDto[];
}

// Giai đoạn 3 (HITL) — delegateRound() trả về dạng này thay vì throw khi
// ReactLoop bị Risk Gate chặn, để Promise.all() ở resolveAnswer() không mất
// kết quả của delegation ANH EM đã chạy song song thành công (cùng lý do đã
// áp cho lỗi thường — xem docstring delegateRound()).
interface ApprovalRequiredDelegateResult {
  approvalRequired: PendingToolCall;
  task: string;
  // Tool ĐÃ chạy thật thành công trước tool bị chặn trong CÙNG lượt ReactLoop
  // — không có field này thì kết quả các tool đó bị rớt khỏi timeline/checkpoint.
  toolCalls: ToolCallTraceDto[];
}

@Processor(EQueueName.AI_ORCHESTRATION_QUEUE, { concurrency: 5 })
export class AiOrchestrationProcessor extends BaseProcessor<
  IProcessAiTriggerJobData,
  void,
  EJobName
> {
  constructor(
    private readonly messageClient: MessageClientService,
    private readonly reactLoop: ReactLoopService,
    private readonly supervisor: SupervisorService,
    private readonly agentStream: AgentStreamService,
    private readonly checkpoint: CheckpointService,
    private readonly mcpClient: McpClientService,
  ) {
    super();
  }

  async process(
    job: Job<IProcessAiTriggerJobData, void, EJobName>,
  ): Promise<void> {
    switch (job.name) {
      case EJobName.PROCESS_AI_TRIGGER: {
        await this.handleAiTrigger(job.data);
        break;
      }
      default:
        this.logger.warn(`Unknown job name: ${job.name}`);
        throw new Error(`Job name ${job.name} is not supported`);
    }
  }

  /**
   * Giai đoạn 3 (HITL), Step 8 (đã revise) — KHÔNG chặn tin nhắn mới khi
   * channel đang có checkpoint pending. Mỗi turn hoàn toàn độc lập: checkpoint
   * khoá theo `replyMessageId` (unique, không phải channelId), state cần để
   * resume (`originalPrompt`/`roundsSoFar`/`history`) được snapshot ngay lúc
   * dừng — turn MỚI chạy song song không đọc/ghi state của turn CŨ ở đâu cả,
   * nên nhiều checkpoint pending cùng lúc trong 1 channel (kể cả cùng 1 user)
   * là AN TOÀN, không có race. Chặn ở đây từng bị coi là "đơn giản hoá" nhưng
   * thực chất chỉ làm rớt hẳn yêu cầu của user khác trong channel — tệ hơn
   * việc chấp nhận nhiều turn chạy song song. Rào chắn còn lại duy nhất:
   * checkpoint quá hạn tự bị `CheckpointCleanupService` reject (không liên
   * quan gì tới việc chặn message mới).
   */
  private async handleAiTrigger(data: IProcessAiTriggerJobData): Promise<void> {
    const {
      userId,
      channelId,
      workspaceId,
      messageId,
      botUserId,
      channelType,
    } = data;

    const reply = await this.messageClient.createMessage({
      channelId,
      senderId: botUserId,
      content: '🤖 Đang xử lý...',
    });

    // 1 root trace = 1 turn hội thoại, bao trùm CẢ vòng lặp Supervisor↔SubAgent
    // (Step 3) — traceable() lồng theo AsyncLocalStorage nên mọi span con
    // (mỗi lượt Supervisor.decide, mỗi ReactLoop) tự nest đúng cây dù chạy
    // qua nhiều vòng, không cần truyền context tay.
    const traced = traceable(
      (d: IProcessAiTriggerJobData, replyId: string) =>
        this.resolveAnswer(d, replyId),
      {
        name: 'ai-orchestration-turn',
        metadata: {
          userId,
          channelId,
          workspaceId,
          messageId: reply.id,
          triggerMessageId: messageId,
        },
      },
    );

    try {
      const result = await traced(data, reply.id);
      await this.messageClient.updateMessage({
        id: reply.id,
        userId: botUserId,
        ...result,
      });
    } catch (error) {
      this.logger.error(
        `AI orchestration failed for message ${messageId}: ${error.message}`,
        error.stack,
      );
      await this.messageClient.updateMessage({
        id: reply.id,
        userId: botUserId,
        content: describeExternalServiceError(error),
      });
    } finally {
      // Luôn báo "done" dù Supervisor tự trả lời hay có delegate (1 hay nhiều
      // vòng), thành công hay lỗi — FE dựa vào tín hiệu này để tắt icon
      // "đang chạy tool...".
      await this.agentStream.emitStep(
        { userId, channelId, messageId: reply.id, channelType },
        { type: 'done' },
      );
    }
  }

  /**
   * Giai đoạn 2, Step 3+8: Supervisor có thể delegate NHIỀU vòng trong cùng 1
   * turn, mỗi vòng có thể gồm NHIỀU agent ĐỘC LẬP chạy song song (fan-out) —
   * sau mỗi vòng, kết quả được đưa lại cho Supervisor để nó quyết định tiếp:
   * đủ tổng hợp trả lời chưa, hay cần delegate thêm. Giới hạn
   * `MAX_SUPERVISOR_ROUNDS` chặn ping-pong vô hạn nếu Supervisor không hội tụ
   * — hết vòng mà chưa hội tụ thì bắt buộc tổng hợp lại (Step 9), không trả
   * thẳng kết quả thô của vòng cuối.
   */
  private async resolveAnswer(
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

    const rounds: SupervisorRoundDto[] = [];
    const toolCalls: ToolCallTraceDto[] = [];

    for (
      let round = 0;
      round < ORCHESTRATION_CONSTANTS.MAX_SUPERVISOR_ROUNDS;
      round++
    ) {
      const decision = await this.supervisor.decide(
        prompt,
        agents,
        rounds,
        history,
      );

      if (decision.action === 'respond') {
        return this.buildAnswer(
          decision.answer || 'Xin lỗi, mình chưa có câu trả lời phù hợp.',
          toolCalls,
        );
      }

      const delegations = this.dedupeByAgent(decision.delegations ?? []);
      // Rỗng hoặc TOÀN BỘ agent đều không hợp lệ — bail sớm, khỏi tốn ReactLoop
      // call nào (delegations.every() trên mảng rỗng tự nhiên trả về true).
      if (
        delegations.every((d) => !agents.some((a) => a.provider === d.agent))
      ) {
        return this.buildAnswer(
          decision.answer ||
            'Mình chưa thể xử lý yêu cầu này với các kết nối hiện có. Vào Settings để kết nối agent phù hợp nhé.',
          toolCalls,
        );
      }

      // delegateRound() không bao giờ throw (tự bắt lỗi ReactLoop bên trong) —
      // Promise.all ở đây an toàn, 1 delegation lỗi không làm mất kết quả của
      // các delegation ANH EM khác đã chạy song song thành công (Step 8).
      const results = await Promise.all(
        delegations.map((d) =>
          this.delegateRound(d, agents, data, prompt, replyMessageId, history),
        ),
      );

      // Fold TOÀN BỘ kết quả (kể cả agent không hợp lệ) vào rounds TRƯỚC khi
      // xử lý approval — nếu 1 delegation cần duyệt trong khi delegation ANH
      // EM khác cùng vòng đã xong, phải giữ lại kết quả anh em đó vào
      // checkpoint, không được mất (Giai đoạn 3, Step 3).
      let approvalNeeded: ApprovalRequiredDelegateResult | null = null;
      results.forEach((result, i) => {
        if (result && 'approvalRequired' in result) {
          // Tool ĐÃ chạy thật trước khi bị chặn trong lượt này vẫn phải hiện —
          // không chỉ delegation "anh em" mới cần giữ lại kết quả (Step 8 cũ).
          toolCalls.push(...result.toolCalls);
          if (!approvalNeeded) approvalNeeded = result;
          return;
        }
        if (result) {
          rounds.push(result.round);
          toolCalls.push(...result.toolCalls);
        } else {
          // agent không có trong danh sách khả dụng — ghi nhận rõ để Supervisor
          // vòng sau biết đã bỏ qua phần này, tránh tưởng nhầm là đã xong.
          rounds.push({
            agent: delegations[i].agent,
            task: delegations[i].task,
            result:
              'Agent này chưa khả dụng (chưa kết nối hoặc chưa có hạ tầng) — bỏ qua, không thực hiện được phần việc này.',
          });
        }
      });

      if (approvalNeeded) {
        return this.pauseForApproval(
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
    const finalAnswer = await this.supervisor.synthesize(prompt, rounds);
    return this.buildAnswer(finalAnswer, toolCalls);
  }

  /** Chặn 1 pathological case: Supervisor trả trùng agent trong CÙNG 1 vòng — giữ phần tử đầu tiên. */
  private dedupeByAgent(delegations: DelegationDto[]): DelegationDto[] {
    const seen = new Set<string>();
    return delegations.filter((d) => {
      if (seen.has(d.agent)) return false;
      seen.add(d.agent);
      return true;
    });
  }

  private buildAnswer(
    content: string,
    toolCalls: ToolCallTraceDto[],
  ): AnswerResult {
    return { content, toolCalls: toolCalls.length > 0 ? toolCalls : undefined };
  }

  /**
   * Chạy đúng 1 delegation: chốt lại agent Supervisor chọn có thật sự nằm
   * trong danh sách đã đưa cho nó không (schema chỉ ép đúng DẠNG JSON, không
   * ép được model không bịa 1 provider ngoài danh sách), rồi chạy ReAct loop
   * thật trên đúng agent đó. Trả `null` nếu agent không hợp lệ — gọi nơi biết
   * rõ nội dung fallback cần hiển thị.
   *
   * KHÔNG BAO GIỜ throw — 1 ReactLoop lỗi (VD MCP server sập) được bắt và trả
   * về như 1 round có kết quả lỗi, thay vì ném lên làm Promise.all() ở
   * resolveAnswer() reject cả loạt, mất luôn kết quả của delegation ANH EM
   * đã chạy song song thành công (Step 8) — kể cả khi ReactLoop đó đã thực
   * hiện side effect thật (VD tạo GitHub issue) trước khi phần khác lỗi.
   * Riêng `ApprovalRequiredError` (Step 3, HITL) trả về dạng
   * `ApprovalRequiredDelegateResult` thay vì round lỗi — resolveAnswer() cần
   * phân biệt được để dừng turn đúng cách (lưu checkpoint) thay vì coi đây là
   * 1 lỗi bình thường.
   */
  private async delegateRound(
    delegation: DelegationDto,
    agents: AvailableAgentDto[],
    data: IProcessAiTriggerJobData,
    originalPrompt: string,
    replyMessageId: string,
    history: ChatHistoryTurnDto[],
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

  /**
   * Giai đoạn 3 (HITL) — dừng turn khi gặp tool rủi ro: tạo message MỚI
   * `approval_request` (KHÔNG update message "Đang xử lý..." bằng nội dung
   * này), lưu checkpoint đủ state để resume (Step 5), rồi trả lời ngắn cho
   * message "Đang xử lý..." trỏ user sang message chờ duyệt.
   *
   * `triggerUserId` (Step 7) đi kèm content để FE biết CHÍNH XÁC ai được phép
   * bấm Approve/Reject trong channel GROUP (nhiều người thấy cùng 1 card) —
   * backend vẫn là nơi enforce thật (`resolveApproval()` so `checkpoint.userId`
   * với JWT, throw `CHECKPOINT_FORBIDDEN` — xem Step 5), field này chỉ để FE
   * ẩn/disable nút cho đúng UX, không phải lớp bảo mật.
   *
   * `messageClient.createMessage()` (message service, TCP) và `checkpoint.create()`
   * (Postgres của chính orchestration) là 2 hệ khác nhau — không thể bọc
   * chung 1 transaction. Nếu `checkpoint.create()` lỗi SAU KHI message đã tạo
   * xong, message "approval_request" sẽ mồ côi (không có checkpoint để
   * resolve, bấm Approve/Reject mãi mãi ra CHECKPOINT_NOT_FOUND) — bắt lỗi
   * riêng để sửa NGAY message đó thành lỗi rõ ràng thay vì để treo im lặng.
   */
  private async pauseForApproval(
    data: IProcessAiTriggerJobData,
    originalPrompt: string,
    rounds: SupervisorRoundDto[],
    toolCalls: ToolCallTraceDto[],
    history: ChatHistoryTurnDto[],
    approvalNeeded: ApprovalRequiredDelegateResult,
  ): Promise<AnswerResult> {
    const { userId, channelId, workspaceId, channelType, botUserId } = data;
    const { approvalRequired: pendingTool, task: pendingTask } = approvalNeeded;

    const preview = await this.buildRiskPreview(pendingTool, userId);

    const approvalContent = {
      type: 'approval_request',
      tool: pendingTool,
      status: 'pending',
      preview,
      triggerUserId: userId,
    };
    const approvalMessage = await this.messageClient.createMessage({
      channelId,
      senderId: botUserId,
      content: approvalContent,
    });

    try {
      await this.checkpoint.create({
        replyMessageId: approvalMessage.id,
        userId,
        channelId,
        workspaceId,
        channelType,
        originalPrompt,
        pendingTool,
        pendingTask,
        roundsSoFar: rounds,
        history,
      });
    } catch (error) {
      this.logger.error(
        `pauseForApproval() failed to persist checkpoint for message ${approvalMessage.id}: ${(error as Error).message}`,
        (error as Error).stack,
      );
      await this.messageClient.updateMessage({
        id: approvalMessage.id,
        userId: botUserId,
        content: '⚠️ Không thể tạo yêu cầu duyệt, vui lòng hỏi lại.',
      });
      throw error;
    }

    // Gắn tool đang chờ duyệt vào toolCalls (kèm mọi tool ĐÃ chạy thật trước
    // đó trong cùng turn) để timeline (MessageToolCallTimeline) hiện đúng như
    // mọi message bot khác — trước đây tool này chỉ nằm trong `content.tool`,
    // không đi qua field `toolCalls` nên timeline không hiện gì. Không dùng
    // được `createMessage()` cho việc này vì CreateMessageDto (message
    // service) chưa hỗ trợ `toolCalls` khi tạo — cập nhật thêm 1 lần ngay sau
    // đó, lỗi thì bỏ qua (chỉ mất phần hiển thị timeline, không ảnh hưởng
    // checkpoint/luồng duyệt chính).
    try {
      await this.messageClient.updateMessage({
        id: approvalMessage.id,
        userId: botUserId,
        content: approvalContent,
        toolCalls: [
          ...toolCalls,
          { tool: `${pendingTool.provider}.${pendingTool.name}`, status: 'awaiting_approval' },
        ],
      });
    } catch (error) {
      this.logger.warn(
        `pauseForApproval() failed to attach toolCalls trace to message ${approvalMessage.id}: ${(error as Error).message}`,
      );
    }

    this.logger.log(
      `pauseForApproval() tool=${pendingTool.provider}.${pendingTool.name} approvalMessageId=${approvalMessage.id}`,
    );
    return this.buildAnswer(
      '⏸️ Cần bạn duyệt 1 hành động trước khi tiếp tục — xem tin nhắn bên dưới.',
      toolCalls,
    );
  }

  private static readonly NO_ESTIMATE_PREVIEW =
    'Không ước lượng được ảnh hưởng, cân nhắc kỹ trước khi duyệt.';

  /**
   * Giai đoạn 3 (HITL), Step 6 — chỉ ước lượng được cho `sql_server.execute_write_query`
   * dạng UPDATE/DELETE (suy ra WHERE từ chính câu lệnh, tự chạy 1 câu
   * SELECT COUNT(*) read-only tương ứng). INSERT (không có gì để đếm trước) và
   * `execute_stored_procedure` (không đoán trước được ảnh hưởng của 1 SP tuỳ
   * ý) chỉ hiện cảnh báo chung — cũng như mọi domain khác ngoài `sql_server`
   * (VD `github.create_issue`).
   */
  private async buildRiskPreview(
    pendingTool: PendingToolCall,
    userId: string,
  ): Promise<string> {
    if (
      pendingTool.provider !== 'sql_server' ||
      pendingTool.name !== 'execute_write_query'
    ) {
      return AiOrchestrationProcessor.NO_ESTIMATE_PREVIEW;
    }

    const target = extractWriteQueryPreviewTarget(
      String(pendingTool.args?.query ?? ''),
    );
    if (!target) {
      return AiOrchestrationProcessor.NO_ESTIMATE_PREVIEW;
    }

    const countQuery = target.whereClause
      ? `SELECT COUNT(*) AS affectedRows FROM ${target.table} WHERE ${target.whereClause}`
      : `SELECT COUNT(*) AS affectedRows FROM ${target.table}`;

    try {
      const result = await this.mcpClient.callTool({
        provider: 'sql_server',
        name: 'execute_read_only_query',
        args: { query: countQuery },
        ownerId: userId,
      });
      const count = parseSingleCountResult(extractTextFromMcpResult(result));
      if (count === null) return AiOrchestrationProcessor.NO_ESTIMATE_PREVIEW;

      return target.whereClause
        ? `Sẽ ảnh hưởng ~${count} dòng.`
        : `⚠️ Câu lệnh KHÔNG có mệnh đề WHERE — sẽ ảnh hưởng TOÀN BỘ bảng (~${count} dòng).`;
    } catch (error) {
      this.logger.warn(
        `buildRiskPreview() không chạy được câu đếm thử: ${(error as Error).message}`,
      );
      return AiOrchestrationProcessor.NO_ESTIMATE_PREVIEW;
    }
  }

  /**
   * Giai đoạn 3 (HITL), Step 5 — user bấm Approve/Reject trên message
   * `approval_request`. "Resume" ở đây KHÔNG phải dựng lại đúng session LLM
   * đã dừng dở (opaque, không serialize được) — mà chạy 1 ReactLoop MỚI cho
   * đúng agent đó, feed thẳng kết quả tool (đã Approve, chạy thật) vào task
   * mới, rồi gọi lại `SupervisorService.synthesize()` (đã có từ Giai đoạn 2)
   * để tổng hợp câu trả lời cuối cùng từ `roundsSoFar` + round mới này.
   *
   * Giới hạn đã biết: nếu ReactLoop resume lại gặp tool rủi ro KHÁC (Risk
   * Gate chặn lần 2), lỗi này rơi vào catch chung bên dưới thay vì tạo
   * checkpoint mới lồng nhau — chưa hỗ trợ chuỗi approval nối tiếp trong 1
   * lần resume, để dành sau nếu cần.
   *
   * `checkpoint.claim()` chuyển trạng thái bằng 1 UPDATE có điều kiện
   * (WHERE status='pending') NGAY sau khi xác thực quyền, trước khi thực thi
   * bất kỳ side effect nào — double-click hoặc 2 tab cùng bấm Approve chỉ 1
   * request "thắng", request còn lại nhận CHECKPOINT_ALREADY_RESOLVED thay vì
   * chạy lại tool nguy hiểm lần 2.
   */
  async resolveApproval(dto: ResolveApprovalRequestDto): Promise<void> {
    const { userId, action } = dto;
    const replyMessageId = dto.messageId;
    const checkpoint = await this.checkpoint.findPendingByReplyMessageId({
      replyMessageId,
    });
    if (!checkpoint) {
      throw new RpcException(ORCHESTRATION_ERROR.CHECKPOINT_NOT_FOUND);
    }
    if (checkpoint.userId !== userId) {
      this.logger.warn(
        `User ${userId} tried to resolve checkpoint ${checkpoint.id} owned by ${checkpoint.userId}`,
      );
      throw new RpcException(ORCHESTRATION_ERROR.CHECKPOINT_FORBIDDEN);
    }

    const {
      id,
      channelId,
      workspaceId,
      channelType,
      pendingTool,
      pendingTask,
      roundsSoFar,
      history,
      originalPrompt,
    } = checkpoint;
    const toStatus =
      action === 'reject'
        ? OrchestrationCheckpointStatus.REJECTED
        : OrchestrationCheckpointStatus.APPROVED;
    const { claimed } = await this.checkpoint.claim({ id, toStatus });
    if (!claimed) {
      throw new RpcException(ORCHESTRATION_ERROR.CHECKPOINT_ALREADY_RESOLVED);
    }

    if (action === 'reject') {
      await this.messageClient.updateMessage({
        id: replyMessageId,
        userId,
        content: '❌ Đã huỷ theo yêu cầu.',
      });
      await this.agentStream.emitStep(
        { userId, channelId, messageId: replyMessageId, channelType },
        { type: 'done' },
      );
      return;
    }

    try {
      const toolResult = await this.mcpClient.callTool({
        provider: pendingTool.provider,
        name: pendingTool.name,
        args: pendingTool.args,
        ownerId: userId,
      });
      const toolResultText = extractTextFromMcpResult(toolResult);

      const resumeTask = `Hành động "${pendingTool.name}" cho yêu cầu "${pendingTask}" đã được user DUYỆT và THỰC THI THẬT. Kết quả: ${toolResultText}\n\nDựa vào kết quả này, hoàn thành nốt câu hỏi gốc của user.`;
      const { answer, toolCalls } = await this.reactLoop.run({
        prompt: resumeTask,
        provider: pendingTool.provider,
        userId,
        channelId,
        workspaceId,
        messageId: replyMessageId,
        channelType,
        history,
      });

      const finalAnswer = await this.supervisor.synthesize(originalPrompt, [
        ...roundsSoFar,
        { agent: pendingTool.provider, task: pendingTask, result: answer },
      ]);

      await this.messageClient.updateMessage({
        id: replyMessageId,
        userId,
        content: finalAnswer,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      });
    } catch (error) {
      this.logger.error(
        `resolveApproval() failed for checkpoint ${id}: ${(error as Error).message}`,
        (error as Error).stack,
      );
      await this.messageClient.updateMessage({
        id: replyMessageId,
        userId,
        content: describeExternalServiceError(error),
      });
    } finally {
      await this.agentStream.emitStep(
        { userId, channelId, messageId: replyMessageId, channelType },
        { type: 'done' },
      );
    }
  }
}
