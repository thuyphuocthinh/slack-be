import { Injectable, Logger } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import {
  EJobName,
  EQueueName,
  IProcessApprovalJobData,
  QueueService,
} from '@slack/queue';
import { ORCHESTRATION_ERROR } from '@slack/constants';
import { extractTextFromMcpResult } from '@slack/common';
import { MessageClientService } from '../message-client.service';
import { SupervisorService } from '../llm/supervisor.service';
import { McpClientService } from '../mcp/mcp-client.service';
import { AgentStreamService } from '../socket/agent-stream.service';
import { describeExternalServiceError } from '../llm/external-service-error.util';
import { CheckpointService } from '../checkpoint/checkpoint.service';
import { OrchestrationCheckpointStatus } from '../entity/orchestration-checkpoint.entity';
import { CheckpointResponseDto } from '../dto/checkpoint.dto';
import { ResolveApprovalRequestDto } from '../dto/orchestration.dto';
import { AgentCancellationService } from '../cancellation/agent-cancellation.service';
import { TurnCancelledError } from '../llm/turn-cancelled.error';
import { TurnResolverService } from './turn-resolver.service';
import { capToolResultSize } from '../executor/tool-result-size-cap.util';

// Giai đoạn 3 (HITL) — toàn bộ vòng đời "duyệt/từ chối 1 hành động rủi ro":
// nhận request duyệt (resolveApproval, nhanh — chỉ claim() rồi trả về), rồi
// thực thi thật trong job nền (processApprovalJob → approveCheckpoint), tách
// khỏi AiOrchestrationProcessor (chỉ còn lo vòng đời job/turn) và khỏi
// TurnResolverService (chỉ lo vòng lặp Supervisor lần ĐẦU, chưa từng duyệt gì).
@Injectable()
export class ApprovalFlowService {
  private readonly logger = new Logger(ApprovalFlowService.name);

  constructor(
    private readonly messageClient: MessageClientService,
    private readonly supervisor: SupervisorService,
    private readonly agentStream: AgentStreamService,
    private readonly checkpoint: CheckpointService,
    private readonly mcpClient: McpClientService,
    private readonly queueService: QueueService,
    private readonly cancellation: AgentCancellationService,
    private readonly turnResolver: TurnResolverService,
  ) {}

  // Chỉ làm phần NHANH (check quyền + claim() atomic) rồi trả về ngay —
  // "approve" thật (gọi tool + resume Supervisor loop, nhiều lượt LLM nối
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
  async processApprovalJob(data: IProcessApprovalJobData): Promise<void> {
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
      workspaceId,
      channelType,
      pendingTool,
      pendingTask,
      roundsSoFar,
      originalPrompt,
      history,
    } = checkpoint;
    // Checkpoint có thể pending tới 24h (CHECKPOINT_EXPIRY_MS) trước khi được
    // duyệt, trong khi bản ghi chủ turn (startTurn ở handleAiTrigger) chỉ sống
    // TURN_TTL (15 phút) — ghi lại NGAY LÚC NÀY để Stop vẫn xác thực được quyền
    // trong suốt thời gian resume/chạy thật (thường vài giây tới vài chục giây).
    await this.cancellation.startTurn(replyMessageId, userId);
    try {
      const { text: toolResultText, isError } =
        await this.executeApprovedToolForReal(checkpoint, userId);

      // Giai đoạn System, mục 6 — hành động ĐÃ được duyệt (destructiveHint) mà
      // tool THẬT trả lỗi (không phải mất kết nối MCP — cái đó đã throw và rơi
      // vào catch() bên dưới, có reconnect riêng ở McpClientService) là lỗi
      // logic/quyền của chính hành động đó (VD thiếu quyền Google API) — DỪNG
      // NGAY, không quay lại continueRounds() để Supervisor tự ý re-plan/thử
      // lại đúng hành động này. Bug thật đã gặp: lỗi này bị coi như 1 round
      // bình thường, Supervisor cứ thử lại → destructiveHint lại yêu cầu duyệt
      // → lặp duyệt/lỗi 5 lần tới khi hết MAX_SUPERVISOR_ROUNDS.
      if (isError) {
        this.logger.warn(
          `approveCheckpoint() checkpoint=${id} — tool "${pendingTool.provider}.${pendingTool.name}" thất bại sau khi duyệt, dừng không retry: ${toolResultText}`,
        );
        await this.messageClient.updateMessage({
          id: replyMessageId,
          userId: botUserId,
          content: `⚠️ Hành động "${pendingTool.name}" đã được duyệt nhưng thực thi thất bại:\n${toolResultText}`,
        });
        return;
      }

      // Chuyển Message UI từ ApprovalRequestCard về text để hiện Markdown
      await this.messageClient.updateMessage({
        id: replyMessageId,
        userId: botUserId,
        content: '🤖 Đang tổng hợp kết quả...',
      });

      // Quay lại ĐÚNG vòng lặp Supervisor (rounds đã có sẵn kết quả hành động
      // vừa duyệt) thay vì resume cứng trên CÙNG agent vừa dùng — để phần việc
      // CÒN LẠI được delegate sang đúng agent cần thiết (có thể là 1 agent
      // KHÁC). Nếu vòng này lại gặp thêm 1 tool rủi ro, TurnResolverService tự
      // pause qua CheckpointPauseService như bình thường — không cần xử lý gì
      // thêm ở đây, dù final answer hay "cần duyệt tiếp" đều chỉ là 1 AnswerResult.
      const agents = await this.supervisor.getAvailableAgents(userId);
      const rounds = [
        ...roundsSoFar,
        {
          agent: pendingTool.provider,
          task: pendingTask,
          result: toolResultText,
        },
      ];
      const data = {
        userId,
        channelId,
        workspaceId,
        messageId: replyMessageId,
        botUserId,
        channelType,
      };

      const result = await this.turnResolver.continueRounds(
        data,
        replyMessageId,
        originalPrompt,
        agents,
        history,
        rounds,
        [],
      );

      await this.messageClient.updateMessage({
        id: replyMessageId,
        userId: botUserId,
        ...result,
      });
    } catch (error) {
      if (error instanceof TurnCancelledError) {
        this.logger.log(
          `approveCheckpoint() checkpoint=${id} bị huỷ theo yêu cầu (Stop)`,
        );
        await this.messageClient.updateMessage({
          id: replyMessageId,
          userId: botUserId,
          content: error.partialText || '⏹️ Đã dừng theo yêu cầu.',
        });
      } else {
        this.logger.error(
          `approveCheckpoint() failed for checkpoint ${id}: ${(error as Error).message}`,
          (error as Error).stack,
        );
        await this.tryDisplayError(replyMessageId, botUserId, error);
      }
    } finally {
      await this.agentStream.emitStep(
        { userId, channelId, messageId: replyMessageId, channelType },
        { type: 'done' },
      );
    }
  }

  // Hành động ĐÃ được duyệt nên gọi tool THẬT trực tiếp, không qua Risk Gate
  // lần nữa. Cap dung lượng kết quả (capToolResultSize) trước khi nó được feed
  // vào round tiếp theo — 1 kết quả tool lớn (VD JSON lồng nhau từ dynamic
  // provider) từng làm sendMessage() của vòng kế tiếp timeout vì context quá to.
  private async executeApprovedToolForReal(
    checkpoint: CheckpointResponseDto,
    userId: string,
  ): Promise<{ text: string; isError: boolean }> {
    const { pendingTool } = checkpoint;
    const toolResult = await this.mcpClient.callTool({
      provider: pendingTool.provider,
      name: pendingTool.name,
      args: pendingTool.args,
      ownerId: userId,
    });
    return {
      text: capToolResultSize(extractTextFromMcpResult(toolResult)),
      isError: Boolean(toolResult.isError),
    };
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
