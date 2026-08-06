import { Injectable, Logger } from '@nestjs/common';
import { IProcessAiTriggerJobData } from '@slack/queue';
import {
  ECheckpointKind,
  ECheckpointRiskLevel,
  EStepExecutionStatus,
} from '@slack/constants';
import { extractTextFromMcpResult } from '@slack/common';
import { MessageClientService } from '../message-client.service';
import { McpClientService } from '../mcp/mcp-client.service';
import { CheckpointService } from '../checkpoint/checkpoint.service';
import {
  AmbiguousAgentCandidate,
  PendingToolCall,
} from '../entity/orchestration-checkpoint.entity';
import { CreateCheckpointRequestDto } from '../dto/checkpoint.dto';
import {
  AvailableAgentDto,
  DelegationDto,
  SupervisorRoundDto,
} from '../dto/supervisor.dto';
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
    // accuracy_problem.md mục 9.2 — các bước CÒN LẠI CHƯA CHẠY của kế hoạch
    // gốc (đã `shift()` bước gây pause ra khỏi mảng này TRƯỚC khi gọi vào
    // đây) — lưu lại để resume ĐÚNG theo kế hoạch gốc, xem
    // TurnResolverService.continueRounds().
    remainingSteps: DelegationDto[],
  ): Promise<AnswerResult> {
    const { userId, channelId, botUserId } = data;
    const { approvalRequired: pendingTool, task: pendingTask } = approvalNeeded;

    const { preview, riskLevel } = await this.buildRiskPreview(
      pendingTool,
      userId,
    );
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

    await this.createCheckpointSafely(
      data,
      approvalMessage.id,
      {
        originalPrompt,
        pendingTool,
        pendingTask,
        roundsSoFar: rounds,
        remainingSteps,
        history,
        riskLevel,
      },
      '⚠️ Không thể tạo yêu cầu duyệt, vui lòng hỏi lại.',
    );
    await this.attachPendingToolCallTrace(
      approvalMessage.id,
      botUserId,
      channelId,
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

  // Dùng chung cho pauseForApproval()/pauseForClarification() — createMessage()
  // (message service, TCP) và checkpoint.create() (Postgres riêng) không bọc
  // chung transaction được — lỗi ở đây để lại message mồ côi (không checkpoint
  // để resolve) nên sửa NGAY message đó thành lỗi rõ ràng.
  private async createCheckpointSafely(
    data: IProcessAiTriggerJobData,
    replyMessageId: string,
    fields: Omit<
      CreateCheckpointRequestDto,
      | 'replyMessageId'
      | 'userId'
      | 'botUserId'
      | 'channelId'
      | 'workspaceId'
      | 'channelType'
    >,
    failureMessage: string,
  ): Promise<void> {
    const { userId, botUserId, channelId, workspaceId, channelType } = data;
    try {
      await this.checkpoint.create({
        replyMessageId,
        userId,
        botUserId,
        channelId,
        workspaceId,
        channelType,
        ...fields,
      });
    } catch (error) {
      this.logger.error(
        `createCheckpointSafely() failed for message ${replyMessageId}: ${(error as Error).message}`,
        (error as Error).stack,
      );
      await this.messageClient.updateMessage({
        id: replyMessageId,
        userId: botUserId,
        content: failureMessage,
      });
      throw error;
    }
  }

  async pauseForClarification(
    data: IProcessAiTriggerJobData,
    originalPrompt: string,
    rounds: SupervisorRoundDto[],
    toolCalls: ToolCallTraceDto[],
    history: ChatHistoryTurnDto[],
    task: string,
    candidates: AvailableAgentDto[],
    remainingSteps: DelegationDto[],
  ): Promise<AnswerResult> {
    const { userId, channelId, botUserId } = data;
    const question = this.buildClarificationQuestion(task, candidates);
    const clarificationContent = {
      type: 'clarification_request',
      question,
      candidates: candidates.map((c) => ({
        provider: c.provider,
        label: c.label,
      })),
      status: 'pending',
      triggerUserId: userId,
    };
    const clarificationMessage = await this.messageClient.createMessage({
      channelId,
      senderId: botUserId,
      content: clarificationContent,
    });

    await this.createCheckpointSafely(
      data,
      clarificationMessage.id,
      {
        originalPrompt,
        pendingTool: null,
        pendingTask: task,
        roundsSoFar: rounds,
        remainingSteps,
        history,
        kind: ECheckpointKind.CLARIFICATION,
        clarificationQuestion: this.buildClarificationQuestion(
          task,
          candidates,
        ),
        clarificationCandidates: candidates.map(
          (c): AmbiguousAgentCandidate => ({
            provider: c.provider,
            label: c.label,
          }),
        ),
      },
      '⚠️ Không thể tạo yêu cầu làm rõ, vui lòng hỏi lại.',
    );

    this.logger.log(
      `pauseForClarification() candidates=${candidates.map((c) => c.provider).join(',')} clarificationMessageId=${clarificationMessage.id}`,
    );
    return buildAnswer(
      '⏸️ Cần bạn làm rõ trước khi tiếp tục — xem tin nhắn bên dưới.',
      toolCalls,
    );
  }

  private buildClarificationQuestion(
    task: string,
    candidates: AvailableAgentDto[],
  ): string {
    const labels = candidates.map((c) => `"${c.label}"`).join(' hay ');
    return `Bạn muốn dùng ${labels} cho việc: "${task}"?`;
  }

  // createMessage() (message service) chưa hỗ trợ toolCalls lúc tạo — gắn
  // thêm bằng 1 update() riêng để timeline hiện tool đang chờ duyệt giống mọi
  // message bot khác. Lỗi ở đây chỉ mất phần hiển thị, không ảnh hưởng luồng chính.
  private async attachPendingToolCallTrace(
    approvalMessageId: string,
    botUserId: string,
    channelId: string,
    approvalContent: Record<string, unknown>,
    toolCalls: ToolCallTraceDto[],
    pendingTool: PendingToolCall,
  ): Promise<void> {
    try {
      await this.messageClient.updateMessage({
        id: approvalMessageId,
        userId: botUserId,
        channelId,
        content: approvalContent,
        toolCalls: [
          ...toolCalls,
          {
            tool: `${pendingTool.provider}.${pendingTool.name}`,
            status: EStepExecutionStatus.AWAITING_APPROVAL,
          },
        ],
      });
    } catch (error) {
      this.logger.warn(
        `attachPendingToolCallTrace() failed for message ${approvalMessageId}: ${(error as Error).message}`,
      );
    }
  }

  // Ước lượng SỐ LIỆU chỉ khả thi cho sql_server.execute_write_query — "đếm
  // dòng ảnh hưởng" không có khái niệm tương đương cho GitHub/Google Docs/
  // dynamic provider... Với MỌI tool khác (và cả khi ước lượng SQL thất bại),
  // fallback KHÔNG còn là câu chung chung vô nghĩa nữa — hiện thẳng tham số
  // THẬT sắp gửi đi (buildGenericArgsPreview), luôn có sẵn cho BẤT KỲ provider
  // nào, không cần biết domain cụ thể.
  //
  // mục 15 — 3 kind preview KHÁC NHAU (write-query-preview.util.ts):
  // 'existing-rows' (UPDATE/DELETE) đếm THỬ qua execute_read_only_query như cũ;
  // 'insert-rows' (INSERT ... VALUES) đếm TRỰC TIẾP từ câu lệnh, khỏi cần hỏi
  // DB; 'whole-table-destructive' (TRUNCATE/DROP) cảnh báo THẲNG không cần đếm
  // gì — huỷ CẢ bảng, số dòng không còn ý nghĩa.
  private async buildRiskPreview(
    pendingTool: PendingToolCall,
    userId: string,
  ): Promise<{ preview: string; riskLevel: ECheckpointRiskLevel | null }> {
    if (
      pendingTool.provider === 'sql_server' &&
      pendingTool.name === 'execute_write_query'
    ) {
      const target = extractWriteQueryPreviewTarget(
        String(pendingTool.args?.query ?? ''),
      );
      if (target?.kind === 'whole-table-destructive') {
        const verb =
          target.operation === 'TRUNCATE' ? 'XOÁ TOÀN BỘ DỮ LIỆU' : 'XOÁ HẲN';
        return {
          preview: `⚠️ Sẽ ${verb} bảng "${target.table}" (${target.operation} — KHÔNG THỂ khôi phục).`,
          riskLevel: ECheckpointRiskLevel.HIGH,
        };
      }
      if (target?.kind === 'insert-rows') {
        // Không bao giờ tới đây trong luồng thật — INSERT tự chạy thẳng ở
        // Risk Gate (react-loop-run.ts), không tạo checkpoint. Giữ nhánh này
        // phòng trường hợp pendingTool bị sửa tay qua edit_and_approve.
        return {
          preview: `Sẽ thêm ~${target.rowCount} dòng mới vào bảng "${target.table}".`,
          riskLevel: ECheckpointRiskLevel.MEDIUM,
        };
      }
      if (target?.kind === 'existing-rows') {
        const count = await this.countAffectedRows(target, userId);
        if (count !== null) {
          return {
            preview: target.whereClause
              ? `Sẽ ảnh hưởng ~${count} dòng.`
              : `⚠️ Câu lệnh KHÔNG có mệnh đề WHERE — sẽ ảnh hưởng TOÀN BỘ bảng (~${count} dòng).`,
            riskLevel: ECheckpointRiskLevel.MEDIUM,
          };
        }
      }
    }

    return {
      preview: this.buildGenericArgsPreview(pendingTool),
      riskLevel: null,
    };
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
    target: Extract<WriteQueryPreviewTarget, { kind: 'existing-rows' }>,
    userId: string,
  ): Promise<number | null> {
    const countQuery = target.whereClause
      ? `SELECT COUNT(*) AS affectedRows FROM ${target.table} WHERE ${target.whereClause}`
      : `SELECT COUNT(*) AS affectedRows FROM ${target.table}`;

    try {
      // TODO Edge MCP Server: thiếu workspaceId ở đây — khi sql_server có
      // perWorkspaceInstance (relay), preview số dòng bị ảnh hưởng của 1
      // workspace dùng relay sẽ route nhầm sang cloud sql_server thay vì
      // relay của chính nó. Ngoài phạm vi Phase 1 (chỉ path write-flow này),
      // xem plan Edge MCP Server.
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
