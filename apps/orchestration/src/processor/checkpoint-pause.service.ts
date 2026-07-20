import { Injectable, Logger } from '@nestjs/common';
import { IProcessAiTriggerJobData } from '@slack/queue';
import { extractTextFromMcpResult } from '@slack/common';
import { MessageClientService } from '../message-client.service';
import { McpClientService } from '../mcp/mcp-client.service';
import { CheckpointService } from '../checkpoint/checkpoint.service';
import { PendingToolCall } from '../entity/orchestration-checkpoint.entity';
import { SupervisorRoundDto } from '../dto/supervisor.dto';
import { ChatHistoryTurnDto } from '../dto/message-client.dto';
import { ToolCallTraceDto } from '../dto/react-loop.dto';
import {
  extractWriteQueryPreviewTarget,
  parseSingleCountResult,
  WriteQueryPreviewTarget,
} from '../llm/write-query-preview.util';
import {
  AnswerResult,
  ApprovalRequiredDelegateResult,
  buildAnswer,
} from './orchestration-answer.types';
import { capToolResultSize } from '../executor/tool-result-size-cap.util';

// Giai đoạn 3 (HITL) — tách riêng khỏi TurnResolverService/ApprovalFlowService
// vì "đi vào trạng thái chờ duyệt" là 1 hành vi độc lập được gọi từ CẢ 2 nơi:
// lần dừng ĐẦU TIÊN (TurnResolverService.resolveAnswer) và lần dừng TIẾP THEO
// nếu vòng resume lại gặp thêm 1 tool rủi ro khác (ApprovalFlowService.approveCheckpoint).
@Injectable()
export class CheckpointPauseService {
  private readonly logger = new Logger(CheckpointPauseService.name);

  constructor(
    private readonly messageClient: MessageClientService,
    private readonly checkpoint: CheckpointService,
    private readonly mcpClient: McpClientService,
  ) {}

  // Dừng turn khi gặp tool rủi ro: tạo message MỚI "approval_request" (không
  // update message "Đang xử lý..."), lưu checkpoint để resume (Step 5), rồi
  // trỏ message "Đang xử lý..." sang message chờ duyệt. `triggerUserId` chỉ
  // để FE ẩn/disable nút cho user khác trong GROUP — bảo mật thật nằm ở
  // resolveApproval() (so checkpoint.userId).
  async pauseForApproval(
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
    return buildAnswer(
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

  // Ước lượng SỐ LIỆU chỉ khả thi cho sql_server.execute_write_query (đếm thử
  // qua execute_read_only_query) — "đếm dòng ảnh hưởng" không có khái niệm
  // tương đương cho GitHub/Google Docs/dynamic provider... Với MỌI tool khác
  // (và cả khi ước lượng SQL thất bại), fallback KHÔNG còn là câu chung chung
  // vô nghĩa nữa — hiện thẳng tham số THẬT sắp gửi đi (buildGenericArgsPreview),
  // luôn có sẵn cho BẤT KỲ provider nào, không cần biết domain cụ thể.
  private async buildRiskPreview(
    pendingTool: PendingToolCall,
    userId: string,
  ): Promise<string> {
    if (
      pendingTool.provider === 'sql_server' &&
      pendingTool.name === 'execute_write_query'
    ) {
      const target = extractWriteQueryPreviewTarget(
        String(pendingTool.args?.query ?? ''),
      );
      if (target) {
        const count = await this.countAffectedRows(target, userId);
        if (count !== null) {
          return target.whereClause
            ? `Sẽ ảnh hưởng ~${count} dòng.`
            : `⚠️ Câu lệnh KHÔNG có mệnh đề WHERE — sẽ ảnh hưởng TOÀN BỘ bảng (~${count} dòng).`;
        }
      }
    }

    return this.buildGenericArgsPreview(pendingTool);
  }

  // Fallback TỔNG QUÁT — hiện nguyên tham số thật sẽ gửi đi kèm tên tool, thay
  // vì "không ước lượng được ảnh hưởng" không mang thông tin gì. capToolResultSize()
  // vì args có thể chứa nội dung dài (VD text sắp append vào Google Docs).
  private buildGenericArgsPreview(pendingTool: PendingToolCall): string {
    const argsText = capToolResultSize(
      JSON.stringify(pendingTool.args ?? {}, null, 2),
    );
    return `Sẽ gọi "${pendingTool.provider}.${pendingTool.name}" với tham số:\n${argsText}\n\nKhông ước lượng được mức độ ảnh hưởng cụ thể — kiểm tra kỹ tham số trên trước khi duyệt.`;
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
}
