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
} from '@slack/queue';
import { ORCHESTRATION_CONSTANTS, ORCHESTRATION_ERROR } from '@slack/constants';
import { MessageClientService } from '../message-client.service';
import { AgentStreamService } from '../socket/agent-stream.service';
import { describeExternalServiceError } from '../llm/external-service-error.util';
import { CancelTurnRequestDto } from '../dto/orchestration.dto';
import { TriggerClaimService } from '../trigger-claim/trigger-claim.service';
import { AgentCancellationService } from '../cancellation/agent-cancellation.service';
import { TurnCancelledError } from '../llm/turn-cancelled.error';
import { TurnResolverService } from './turn-resolver.service';
import { ApprovalFlowService } from './approval-flow.service';

type AiOrchestrationJobData =
  | IProcessAiTriggerJobData
  | IProcessApprovalJobData;

// Chỉ còn lo vòng đời job/turn (claim, placeholder message, trace, catch/finally
// hiển thị kết quả) — vòng lặp Supervisor nằm ở TurnResolverService, toàn bộ
// luồng duyệt/thực thi HITL nằm ở ApprovalFlowService.
@Processor(EQueueName.AI_ORCHESTRATION_QUEUE, {
  concurrency: ORCHESTRATION_CONSTANTS.AI_ORCHESTRATION_QUEUE_CONCURRENCY,
  lockDuration: 60000,
  maxStalledCount: 1,
})
export class AiOrchestrationProcessor extends BaseProcessor<
  AiOrchestrationJobData,
  void,
  EJobName
> {
  constructor(
    private readonly messageClient: MessageClientService,
    private readonly agentStream: AgentStreamService,
    private readonly triggerClaim: TriggerClaimService,
    private readonly cancellation: AgentCancellationService,
    private readonly turnResolver: TurnResolverService,
    private readonly approvalFlow: ApprovalFlowService,
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
        const data = job.data as IProcessApprovalJobData;
        // Cùng lý do handleAiTrigger() — thiếu cái này thì processApprovalJob()
        // (và mọi sendMessage/generateStructured/callTool bên trong nó, xuyên
        // qua continueRounds()) chạy KHÔNG có root trace nào bao quanh, mỗi lời
        // gọi tự thành 1 trace gốc rời rạc thay vì nest chung 1 cây — bug thật
        // gặp khi 1 turn phải duyệt (approve) nhiều lần: mỗi lần duyệt tạo ra
        // hàng loạt trace lẻ (openai.sendMessage, mcp.callTool...) không liên
        // kết, thay vì đúng "1 lần duyệt = 1 trace".
        const traced = traceable(
          (d: IProcessApprovalJobData) =>
            this.approvalFlow.processApprovalJob(d),
          {
            name: 'ai-orchestration-approval',
            metadata: { checkpointId: data.checkpointId, userId: data.userId },
          },
        );
        await traced(data);
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
    // Ghi lại chủ turn NGAY khi bắt đầu chạy — endpoint Stop cần biết ai được
    // phép huỷ (chỉ đúng userId này), và vòng lặp bên trong cần biết khoá Redis
    // nào để tự kiểm tra (đều khoá theo reply.id, xem AgentCancellationService).
    await this.cancellation.startTurn(reply.id, userId);

    // traceable() lồng theo AsyncLocalStorage — 1 root trace/turn, tự nest mọi span con.
    const traced = traceable(
      (d: IProcessAiTriggerJobData, replyId: string) =>
        this.turnResolver.resolveAnswer(d, replyId),
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
      if (error instanceof TurnCancelledError) {
        this.logger.log(
          `handleAiTrigger() messageId=${messageId} bị huỷ theo yêu cầu (Stop)`,
        );
        // Giữ nguyên phần đã stream (nếu có) làm nội dung lưu — giống
        // ChatGPT/Claude: dừng thì giữ nguyên phần đã có, không xoá sạch
        // thay bằng 1 câu thông báo. Chỉ dùng câu thông báo khi CHƯA sinh ra
        // được gì (huỷ gần như ngay lập tức).
        await this.messageClient.updateMessage({
          id: reply.id,
          userId: botUserId,
          content: error.partialText || '⏹️ Đã dừng theo yêu cầu.',
        });
      } else {
        this.logger.error(
          `AI orchestration failed for message ${messageId}: ${error.message}`,
          error.stack,
        );
        await this.messageClient.updateMessage({
          id: reply.id,
          userId: botUserId,
          content: describeExternalServiceError(error),
        });
      }
    } finally {
      // Luôn báo "done" — FE dựa vào đây để tắt icon "đang chạy tool...".
      await this.agentStream.emitStep(
        { userId, channelId, messageId: reply.id, channelType },
        { type: 'done' },
      );
    }
  }

  // Chỉ đặt cờ huỷ vào Redis rồi trả về ngay — vòng lặp đang chạy (ReactLoop
  // hoặc round loop của TurnResolverService) tự phát hiện qua isCancelled()/signal,
  // không có gì để "chờ" ở đây cả.
  async cancelTurn(dto: CancelTurnRequestDto): Promise<void> {
    const owner = await this.cancellation.getOwner(dto.messageId);
    if (!owner) {
      throw new RpcException(ORCHESTRATION_ERROR.TURN_NOT_FOUND);
    }
    if (owner !== dto.userId) {
      this.logger.warn(
        `User ${dto.userId} tried to stop turn ${dto.messageId} owned by ${owner}`,
      );
      throw new RpcException(ORCHESTRATION_ERROR.TURN_FORBIDDEN);
    }
    await this.cancellation.requestCancel(dto.messageId);
  }
}
