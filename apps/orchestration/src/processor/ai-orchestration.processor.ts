import { Processor } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { RpcException } from '@nestjs/microservices';
import { traceable } from 'langsmith/traceable';
import {
  BaseProcessor,
  EJobName,
  EQueueName,
  IProcessAiTriggerJobData,
  IProcessApprovalJobData,
  QueueService,
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
  WriteQueryPreviewTarget,
} from '../llm/write-query-preview.util';
import { CheckpointService } from '../checkpoint/checkpoint.service';
import {
  OrchestrationCheckpointStatus,
  PendingToolCall,
} from '../entity/orchestration-checkpoint.entity';
import { CheckpointResponseDto } from '../dto/checkpoint.dto';
import { ResolveApprovalRequestDto } from '../dto/orchestration.dto';
import { TriggerClaimService } from '../trigger-claim/trigger-claim.service';

interface AnswerResult {
  // Object content (approval_request) đi qua createMessage() riêng, không qua đây.
  content: string;
  toolCalls?: ToolCallTraceDto[];
}

interface DelegateRoundResult {
  round: SupervisorRoundDto;
  toolCalls: ToolCallTraceDto[];
}

// delegateRound() trả dạng này thay vì throw khi bị Risk Gate chặn, để
// Promise.all() không mất kết quả của delegation anh em chạy song song.
interface ApprovalRequiredDelegateResult {
  approvalRequired: PendingToolCall;
  task: string;
  toolCalls: ToolCallTraceDto[];
}

type AiOrchestrationJobData =
  | IProcessAiTriggerJobData
  | IProcessApprovalJobData;

@Processor(EQueueName.AI_ORCHESTRATION_QUEUE, {
  concurrency: 5,
  lockDuration: 60000,
  maxStalledCount: 1,
})
export class AiOrchestrationProcessor extends BaseProcessor<
  AiOrchestrationJobData,
  void,
  EJobName
> {
  private static readonly NO_ESTIMATE_PREVIEW =
    'Không ước lượng được ảnh hưởng, cân nhắc kỹ trước khi duyệt.';

  constructor(
    private readonly messageClient: MessageClientService,
    private readonly reactLoop: ReactLoopService,
    private readonly supervisor: SupervisorService,
    private readonly agentStream: AgentStreamService,
    private readonly checkpoint: CheckpointService,
    private readonly mcpClient: McpClientService,
    private readonly queueService: QueueService,
    private readonly triggerClaim: TriggerClaimService,
  ) {
    super();
  }

  async process(
    job: Job<AiOrchestrationJobData, void, EJobName>,
  ): Promise<void> {
    switch (job.name) {
      case EJobName.PROCESS_AI_TRIGGER: {
        await this.handleAiTrigger(job.data as IProcessAiTriggerJobData);
        break;
      }
      case EJobName.PROCESS_APPROVAL: {
        await this.processApprovalJob(job.data as IProcessApprovalJobData);
        break;
      }
      default:
        this.logger.warn(`Unknown job name: ${job.name}`);
        throw new Error(`Job name ${job.name} is not supported`);
    }
  }

  // Mỗi turn độc lập hoàn toàn (checkpoint khoá theo replyMessageId, không
  // theo channel) — không chặn tin nhắn mới dù channel đang có checkpoint
  // pending khác (Step 8, đã revise: chặn từng làm rớt câu hỏi của user khác).
  private async handleAiTrigger(data: IProcessAiTriggerJobData): Promise<void> {
    const {
      userId,
      channelId,
      workspaceId,
      messageId,
      botUserId,
      channelType,
    } = data;

    // Giai đoạn 4, Step 1 — claim atomic (insert-once) TRƯỚC khi tạo message
    // placeholder. Nếu job này bị BullMQ retry/redeliver (lỗi tạm thời, worker
    // crash giữa chừng) cho CÙNG messageId, lần chạy sau claim() thất bại và bỏ
    // qua — tránh tạo thêm 1 message "Đang xử lý..." trùng.
    const claimed = await this.triggerClaim.claim(messageId);
    if (!claimed) {
      this.logger.warn(
        `handleAiTrigger() messageId=${messageId} đã được claim trước đó — bỏ qua (job bị retry/redeliver)`,
      );
      return;
    }

    const reply = await this.messageClient.createMessage({
      channelId,
      senderId: botUserId,
      content: '🤖 Đang xử lý...',
    });

    // traceable() lồng theo AsyncLocalStorage — 1 root trace/turn, tự nest mọi span con.
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
      // Luôn báo "done" — FE dựa vào đây để tắt icon "đang chạy tool...".
      await this.agentStream.emitStep(
        { userId, channelId, messageId: reply.id, channelType },
        { type: 'done' },
      );
    }
  }

  // Supervisor có thể delegate nhiều vòng, mỗi vòng nhiều agent song song
  // (fan-out). MAX_SUPERVISOR_ROUNDS chặn ping-pong vô hạn — hết vòng thì bắt
  // buộc tổng hợp lại thay vì trả thẳng kết quả thô của vòng cuối.
  private async resolveAnswer(
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
          return this.buildAnswer(rounds[0].result, toolCalls);
        }
        if (rounds.length > 1) {
          const finalAnswer = await this.supervisor.synthesize(
            prompt,
            rounds,
            this.buildOnToken(userId, channelId, replyMessageId, channelType),
          );
          return this.buildAnswer(finalAnswer, toolCalls);
        }
        return this.buildAnswer(
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
        return this.buildAnswer(
          decision.answer ||
            `Mình chưa thể xử lý yêu cầu này với các kết nối hiện có (Tên hệ thống mà AI đang cố gọi: "${attemptedAgents}" - Vui lòng đổi tên hoặc viết đúng tên). Vào Settings để kết nối agent phù hợp nhé.`,
          toolCalls,
        );
      }

      // delegateRound() không bao giờ throw — 1 delegation lỗi không làm mất
      // kết quả của delegation anh em đã chạy song song thành công.
      const results = await Promise.all(
        delegations.map((d) =>
          this.delegateRound(d, agents, data, prompt, replyMessageId, history),
        ),
      );

      const approvalNeeded = this.foldRoundResults(
        results,
        delegations,
        rounds,
        toolCalls,
      );
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
    const finalAnswer = await this.supervisor.synthesize(
      prompt,
      rounds,
      this.buildOnToken(userId, channelId, replyMessageId, channelType),
    );
    return this.buildAnswer(finalAnswer, toolCalls);
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

  private buildAnswer(
    content: string,
    toolCalls: ToolCallTraceDto[],
  ): AnswerResult {
    return { content, toolCalls: toolCalls.length > 0 ? toolCalls : undefined };
  }

  // Dùng chung cho mọi lệnh gọi LLM cần stream ra đúng messageId của bot reply
  // (synthesize() ở nhánh respond multi-agent, ở fallback hết MAX_SUPERVISOR_ROUNDS,
  // và ở approveCheckpoint) — đảm bảo nội dung stream ra và nội dung lưu DB luôn
  // đến từ CÙNG 1 lời gọi (nguyên tắc "stream = save").
  private buildOnToken(
    userId: string,
    channelId: string,
    messageId: string,
    channelType: string,
  ): (chunk: string) => void {
    return (chunk: string) => {
      this.agentStream
        .emitStep(
          { userId, channelId, messageId, channelType },
          { type: 'token', text: chunk },
        )
        .catch(() => {});
    };
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

  // Dừng turn khi gặp tool rủi ro: tạo message MỚI "approval_request" (không
  // update message "Đang xử lý..."), lưu checkpoint để resume (Step 5), rồi
  // trỏ message "Đang xử lý..." sang message chờ duyệt. `triggerUserId` chỉ
  // để FE ẩn/disable nút cho user khác trong GROUP — bảo mật thật nằm ở
  // resolveApproval() (so checkpoint.userId).
  private async pauseForApproval(
    data: IProcessAiTriggerJobData,
    originalPrompt: string,
    rounds: SupervisorRoundDto[],
    toolCalls: ToolCallTraceDto[],
    history: ChatHistoryTurnDto[],
    approvalNeeded: ApprovalRequiredDelegateResult,
  ): Promise<AnswerResult> {
    const { userId, channelId, botUserId } = data;
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

    await this.persistCheckpoint(
      approvalMessage.id,
      data,
      originalPrompt,
      pendingTool,
      pendingTask,
      rounds,
      history,
    );
    await this.attachPendingToolCallTrace(
      approvalMessage.id,
      botUserId,
      approvalContent,
      toolCalls,
      pendingTool,
    );

    this.logger.log(
      `pauseForApproval() tool=${pendingTool.provider}.${pendingTool.name} approvalMessageId=${approvalMessage.id}`,
    );
    return this.buildAnswer(
      '⏸️ Cần bạn duyệt 1 hành động trước khi tiếp tục — xem tin nhắn bên dưới.',
      toolCalls,
    );
  }

  // createMessage() (message service, TCP) và checkpoint.create() (Postgres
  // riêng) không bọc chung transaction được — lỗi ở đây để lại message mồ côi
  // (không checkpoint để resolve) nên sửa NGAY message đó thành lỗi rõ ràng.
  private async persistCheckpoint(
    approvalMessageId: string,
    data: IProcessAiTriggerJobData,
    originalPrompt: string,
    pendingTool: PendingToolCall,
    pendingTask: string,
    rounds: SupervisorRoundDto[],
    history: ChatHistoryTurnDto[],
  ): Promise<void> {
    const { userId, botUserId, channelId, workspaceId, channelType } = data;
    try {
      await this.checkpoint.create({
        replyMessageId: approvalMessageId,
        userId,
        botUserId,
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
        `persistCheckpoint() failed for message ${approvalMessageId}: ${(error as Error).message}`,
        (error as Error).stack,
      );
      await this.messageClient.updateMessage({
        id: approvalMessageId,
        userId: botUserId,
        content: '⚠️ Không thể tạo yêu cầu duyệt, vui lòng hỏi lại.',
      });
      throw error;
    }
  }

  // createMessage() (message service) chưa hỗ trợ toolCalls lúc tạo — gắn
  // thêm bằng 1 update() riêng để timeline hiện tool đang chờ duyệt giống mọi
  // message bot khác. Lỗi ở đây chỉ mất phần hiển thị, không ảnh hưởng luồng chính.
  private async attachPendingToolCallTrace(
    approvalMessageId: string,
    botUserId: string,
    approvalContent: Record<string, unknown>,
    toolCalls: ToolCallTraceDto[],
    pendingTool: PendingToolCall,
  ): Promise<void> {
    try {
      await this.messageClient.updateMessage({
        id: approvalMessageId,
        userId: botUserId,
        content: approvalContent,
        toolCalls: [
          ...toolCalls,
          {
            tool: `${pendingTool.provider}.${pendingTool.name}`,
            status: 'awaiting_approval',
          },
        ],
      });
    } catch (error) {
      this.logger.warn(
        `attachPendingToolCallTrace() failed for message ${approvalMessageId}: ${(error as Error).message}`,
      );
    }
  }

  // Chỉ ước lượng được UPDATE/DELETE của sql_server.execute_write_query —
  // INSERT, stored procedure, và domain khác (VD github) chỉ hiện cảnh báo chung.
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
    if (!target) return AiOrchestrationProcessor.NO_ESTIMATE_PREVIEW;

    const count = await this.countAffectedRows(target, userId);
    if (count === null) return AiOrchestrationProcessor.NO_ESTIMATE_PREVIEW;

    return target.whereClause
      ? `Sẽ ảnh hưởng ~${count} dòng.`
      : `⚠️ Câu lệnh KHÔNG có mệnh đề WHERE — sẽ ảnh hưởng TOÀN BỘ bảng (~${count} dòng).`;
  }

  private async countAffectedRows(
    target: WriteQueryPreviewTarget,
    userId: string,
  ): Promise<number | null> {
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
      return parseSingleCountResult(extractTextFromMcpResult(result));
    } catch (error) {
      this.logger.warn(
        `countAffectedRows() không chạy được câu đếm thử: ${(error as Error).message}`,
      );
      return null;
    }
  }

  // Chỉ làm phần NHANH (check quyền + claim() atomic) rồi trả về ngay —
  // "approve" thật (gọi tool + resume ReactLoop + synthesize, 2 lượt LLM nối
  // tiếp) có thể mất 10-20s, đẩy qua queue để HTTP request không phải chờ.
  // "reject" đủ nhanh (1 lần updateMessage) nên vẫn xử lý luôn tại đây.
  async resolveApproval(dto: ResolveApprovalRequestDto): Promise<void> {
    const checkpoint = await this.loadOwnedCheckpoint(dto);
    const toStatus =
      dto.action === 'reject'
        ? OrchestrationCheckpointStatus.REJECTED
        : OrchestrationCheckpointStatus.APPROVED;

    // Atomic UPDATE (WHERE status='pending') trước khi làm gì khác — double-click/2 tab chỉ 1 request "thắng".
    const { claimed } = await this.checkpoint.claim({
      id: checkpoint.id,
      toStatus,
    });
    if (!claimed) {
      throw new RpcException(ORCHESTRATION_ERROR.CHECKPOINT_ALREADY_RESOLVED);
    }

    if (dto.action === 'reject') {
      await this.rejectCheckpoint(checkpoint, dto.userId);
      return;
    }

    // attempts:1 — mcpClient.callTool() không idempotent (VD UPDATE, tạo
    // issue thật), auto-retry mặc định của queue sẽ chạy lại tool THẬT lần 2.
    await this.queueService.addJob(
      EQueueName.AI_ORCHESTRATION_QUEUE,
      EJobName.PROCESS_APPROVAL,
      { checkpointId: checkpoint.id, userId: dto.userId },
      { attempts: 1 },
    );
  }

  // Checkpoint đã claim() 'approved' TRƯỚC khi job này chạy (xem
  // resolveApproval()) — findPendingByReplyMessageId() sẽ không tìm ra nữa
  // (status không còn 'pending'), nên fetch lại thẳng theo id.
  private async processApprovalJob(
    data: IProcessApprovalJobData,
  ): Promise<void> {
    const checkpoint = await this.checkpoint.findById({
      id: data.checkpointId,
    });
    if (!checkpoint) {
      this.logger.error(
        `processApprovalJob() checkpoint ${data.checkpointId} not found`,
      );
      return;
    }

    // Giai đoạn 4, Step 1 — claim atomic RIÊNG cho lần thực thi, độc lập với
    // claim() (status) đã chạy trước khi enqueue job này. attempts:1 (Giai
    // đoạn 3) không chắc chắn chặn được BullMQ stalled-job redelivery (khác cơ
    // chế với retry-do-lỗi) — claim này chặn dứt điểm mcpClient.callTool()
    // (không idempotent) chạy lại lần 2 bất kể job bị redeliver kiểu gì.
    const { claimed } = await this.checkpoint.claimExecution({
      id: checkpoint.id,
    });
    if (!claimed) {
      this.logger.warn(
        `processApprovalJob() checkpoint ${checkpoint.id} đã được thực thi trước đó — bỏ qua (job bị retry/redeliver)`,
      );
      return;
    }

    await this.approveCheckpoint(checkpoint, data.userId);
  }

  private async loadOwnedCheckpoint(
    dto: ResolveApprovalRequestDto,
  ): Promise<CheckpointResponseDto> {
    const checkpoint = await this.checkpoint.findPendingByReplyMessageId({
      replyMessageId: dto.messageId,
    });
    if (!checkpoint) {
      throw new RpcException(ORCHESTRATION_ERROR.CHECKPOINT_NOT_FOUND);
    }
    if (checkpoint.userId !== dto.userId) {
      this.logger.warn(
        `User ${dto.userId} tried to resolve checkpoint ${checkpoint.id} owned by ${checkpoint.userId}`,
      );
      throw new RpcException(ORCHESTRATION_ERROR.CHECKPOINT_FORBIDDEN);
    }
    return checkpoint;
  }

  private async rejectCheckpoint(
    checkpoint: CheckpointResponseDto,
    userId: string,
  ): Promise<void> {
    const { replyMessageId, botUserId, channelId, channelType } = checkpoint;
    await this.messageClient.updateMessage({
      id: replyMessageId,
      userId: botUserId,
      content: '❌ Đã huỷ theo yêu cầu.',
    });
    await this.agentStream.emitStep(
      { userId, channelId, messageId: replyMessageId, channelType },
      { type: 'done' },
    );
  }

  private async approveCheckpoint(
    checkpoint: CheckpointResponseDto,
    userId: string,
  ): Promise<void> {
    const {
      id,
      replyMessageId,
      botUserId,
      channelId,
      channelType,
      pendingTool,
      pendingTask,
      roundsSoFar,
      originalPrompt,
    } = checkpoint;
    try {
      const { text, toolCalls } = await this.executeApprovedTool(
        checkpoint,
        userId,
      );

      // Xoá luồng stream cũ (do ReactLoop vừa chạy trong executeApprovedTool sinh ra)
      await this.agentStream.emitStep(
        { userId, channelId, messageId: replyMessageId, channelType },
        { type: 'done' },
      );

      // Chuyển Message UI từ ApprovalRequestCard về text để hiện Markdown
      await this.messageClient.updateMessage({
        id: replyMessageId,
        userId: botUserId,
        content: '🤖 Đang tổng hợp kết quả...',
      });

      const finalAnswer = await this.supervisor.synthesize(
        originalPrompt,
        [
          ...roundsSoFar,
          { agent: pendingTool.provider, task: pendingTask, result: text },
        ],
        this.buildOnToken(userId, channelId, replyMessageId, channelType),
      );
      await this.messageClient.updateMessage({
        id: replyMessageId,
        userId: botUserId,
        content: finalAnswer,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      });
    } catch (error) {
      this.logger.error(
        `approveCheckpoint() failed for checkpoint ${id}: ${(error as Error).message}`,
        (error as Error).stack,
      );
      await this.tryDisplayError(replyMessageId, botUserId, error);
    } finally {
      await this.agentStream.emitStep(
        { userId, channelId, messageId: replyMessageId, channelType },
        { type: 'done' },
      );
    }
  }

  private async executeApprovedTool(
    checkpoint: CheckpointResponseDto,
    userId: string,
  ): Promise<{ text: string; toolCalls: ToolCallTraceDto[] }> {
    const {
      pendingTool,
      pendingTask,
      channelId,
      workspaceId,
      channelType,
      replyMessageId,
      history,
    } = checkpoint;

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
    return { text: answer, toolCalls };
  }

  // Checkpoint đã claim() xong (không rollback) — nếu NGAY CẢ update báo lỗi
  // này cũng lỗi, tuyệt đối không văng tiếp ra ngoài (bấm lại sẽ luôn ra
  // CHECKPOINT_NOT_FOUND mà không ai biết lỗi gốc nằm đâu).
  private async tryDisplayError(
    replyMessageId: string,
    botUserId: string,
    error: unknown,
  ): Promise<void> {
    try {
      await this.messageClient.updateMessage({
        id: replyMessageId,
        userId: botUserId,
        content: describeExternalServiceError(error),
      });
    } catch (updateError) {
      this.logger.error(
        `tryDisplayError() also failed for message ${replyMessageId}: ${(updateError as Error).message}`,
        (updateError as Error).stack,
      );
    }
  }
}
