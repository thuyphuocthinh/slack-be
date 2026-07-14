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
import { ReactLoopService } from '../llm/react-loop.service';
import { SupervisorService } from '../llm/supervisor.service';
import { McpClientService } from '../mcp/mcp-client.service';
import { ToolCallTraceDto } from '../dto/react-loop.dto';
import { AgentStreamService } from '../socket/agent-stream.service';
import { describeExternalServiceError } from '../llm/external-service-error.util';
import { ApprovalRequiredError } from '../llm/approval-required.error';
import { CheckpointService } from '../checkpoint/checkpoint.service';
import { OrchestrationCheckpointStatus } from '../entity/orchestration-checkpoint.entity';
import { CheckpointResponseDto } from '../dto/checkpoint.dto';
import { ResolveApprovalRequestDto } from '../dto/orchestration.dto';
import { AgentCancellationService } from '../cancellation/agent-cancellation.service';
import { runCancellable } from '../common/cancellable-run.util';
import { TurnCancelledError } from '../llm/turn-cancelled.error';
import { CheckpointPauseService } from './checkpoint-pause.service';
import { buildOnToken } from './agent-stream-token.util';
import { ApprovalRequiredResumeResult } from './orchestration-answer.types';

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
    private readonly reactLoop: ReactLoopService,
    private readonly supervisor: SupervisorService,
    private readonly agentStream: AgentStreamService,
    private readonly checkpoint: CheckpointService,
    private readonly mcpClient: McpClientService,
    private readonly queueService: QueueService,
    private readonly cancellation: AgentCancellationService,
    private readonly checkpointPause: CheckpointPauseService,
  ) {}

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
      channelType,
      pendingTool,
      pendingTask,
      roundsSoFar,
      originalPrompt,
    } = checkpoint;
    // Checkpoint có thể pending tới 24h (CHECKPOINT_EXPIRY_MS) trước khi được
    // duyệt, trong khi bản ghi chủ turn (startTurn ở handleAiTrigger) chỉ sống
    // TURN_TTL (15 phút) — ghi lại NGAY LÚC NÀY để Stop vẫn xác thực được quyền
    // trong suốt thời gian resume/chạy thật (thường vài giây tới vài chục giây).
    await this.cancellation.startTurn(replyMessageId, userId);
    try {
      const resumeResult = await this.executeApprovedTool(checkpoint, userId);

      // Xoá luồng stream cũ (do ReactLoop vừa chạy trong executeApprovedTool sinh ra)
      await this.agentStream.emitStep(
        { userId, channelId, messageId: replyMessageId, channelType },
        { type: 'done' },
      );

      // Vòng resume vừa gặp THÊM 1 tool rủi ro khác — không có kết quả cuối để
      // tổng hợp, phải dừng lại chờ duyệt tiếp giống hệt lần đầu (tạo checkpoint
      // MỚI nối tiếp), thay vì để lỗi bay lên rồi báo sai thành "crash".
      if ('approvalRequired' in resumeResult) {
        this.logger.log(
          `approveCheckpoint() checkpoint=${id} cần duyệt thêm 1 hành động khác: ${resumeResult.approvalRequired.provider}.${resumeResult.approvalRequired.name}`,
        );
        const pauseResult = await this.checkpointPause.pauseForApproval(
          {
            userId,
            channelId,
            workspaceId: checkpoint.workspaceId,
            messageId: replyMessageId,
            botUserId,
            channelType,
          },
          originalPrompt,
          [
            ...roundsSoFar,
            {
              agent: pendingTool.provider,
              task: pendingTask,
              result: resumeResult.firstActionResult,
            },
          ],
          resumeResult.toolCalls,
          checkpoint.history,
          {
            approvalRequired: resumeResult.approvalRequired,
            task: resumeResult.task,
            toolCalls: resumeResult.toolCalls,
          },
        );
        await this.messageClient.updateMessage({
          id: replyMessageId,
          userId: botUserId,
          ...pauseResult,
        });
        return;
      }

      const { text, toolCalls } = resumeResult;

      // Chuyển Message UI từ ApprovalRequestCard về text để hiện Markdown
      await this.messageClient.updateMessage({
        id: replyMessageId,
        userId: botUserId,
        content: '🤖 Đang tổng hợp kết quả...',
      });

      const approveAccumulator = { text: '' };
      const finalAnswer = await runCancellable(
        replyMessageId,
        this.cancellation,
        (signal) =>
          this.supervisor.synthesize(
            originalPrompt,
            [
              ...roundsSoFar,
              { agent: pendingTool.provider, task: pendingTask, result: text },
            ],
            buildOnToken(
              this.agentStream,
              userId,
              channelId,
              replyMessageId,
              channelType,
              approveAccumulator,
            ),
            signal,
          ),
        () => new TurnCancelledError(approveAccumulator.text || undefined),
      );
      await this.messageClient.updateMessage({
        id: replyMessageId,
        userId: botUserId,
        content: finalAnswer,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
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

  // Hành động ĐẦU (pendingTool) đã được duyệt nên gọi tool THẬT trực tiếp,
  // không qua Risk Gate lần nữa. Nhưng vòng resume sau đó (reactLoop.run())
  // vẫn có thể gặp THÊM 1 tool rủi ro khác — trả về dạng approvalRequired thay
  // vì để ApprovalRequiredError bay thẳng lên (mất luôn kết quả hành động đầu
  // vừa chạy xong, và approveCheckpoint() không biết đường tạo checkpoint mới).
  private async executeApprovedTool(
    checkpoint: CheckpointResponseDto,
    userId: string,
  ): Promise<
    | { text: string; toolCalls: ToolCallTraceDto[] }
    | ApprovalRequiredResumeResult
  > {
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

    try {
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
    } catch (error) {
      if (error instanceof ApprovalRequiredError) {
        return {
          approvalRequired: error.pendingTool,
          task: pendingTask,
          toolCalls: error.toolCalls,
          firstActionResult: toolResultText,
        };
      }
      throw error;
    }
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
