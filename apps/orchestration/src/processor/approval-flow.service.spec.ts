import { Test, TestingModule } from '@nestjs/testing';
import {
  EJobName,
  EQueueName,
  IProcessApprovalJobData,
  QueueService,
} from '@slack/queue';
import { ApprovalFlowService } from './approval-flow.service';
import { MessageClientService } from '../message-client.service';
import { SupervisorService } from '../llm/supervisor.service';
import { AgentStreamService } from '../socket/agent-stream.service';
import { CheckpointService } from '../checkpoint/checkpoint.service';
import { McpClientService } from '../mcp/mcp-client.service';
import { OrchestrationCheckpointStatus } from '../entity/orchestration-checkpoint.entity';
import { AgentCancellationService } from '../cancellation/agent-cancellation.service';
import { TurnCancelledError } from '../llm/turn-cancelled.error';
import { TurnResolverService } from './turn-resolver.service';

// approval-flow.service.ts import @slack/common ở module scope (extractTextFromMcpResult)
// — mock thẳng barrel để tránh kéo theo "nanoid" (ESM-only) mà jest không transform được.
jest.mock('@slack/common', () => ({ extractTextFromMcpResult: jest.fn() }));
import { extractTextFromMcpResult } from '@slack/common';

describe('ApprovalFlowService', () => {
  let service: ApprovalFlowService;

  const mockMessageClient = { updateMessage: jest.fn() };
  const mockSupervisor = { getAvailableAgents: jest.fn() };
  const mockAgentStream = { emitStep: jest.fn() };
  const mockCheckpoint = {
    findPendingByReplyMessageId: jest.fn(),
    findById: jest.fn(),
    claim: jest.fn(),
    claimExecution: jest.fn(),
  };
  const mockMcpClient = { callTool: jest.fn() };
  const mockQueueService = { addJob: jest.fn() };
  const mockCancellation = { startTurn: jest.fn() };
  const mockTurnResolver = { continueRounds: jest.fn() };

  beforeEach(async () => {
    mockMessageClient.updateMessage.mockResolvedValue(undefined);
    mockAgentStream.emitStep.mockResolvedValue(undefined);
    mockCheckpoint.claim.mockResolvedValue({ claimed: true });
    mockCheckpoint.claimExecution.mockResolvedValue({ claimed: true });
    mockQueueService.addJob.mockResolvedValue({ id: 'job-1' });
    mockSupervisor.getAvailableAgents.mockResolvedValue([]);
    mockTurnResolver.continueRounds.mockResolvedValue({
      content: 'ok',
      toolCalls: undefined,
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ApprovalFlowService,
        { provide: MessageClientService, useValue: mockMessageClient },
        { provide: SupervisorService, useValue: mockSupervisor },
        { provide: AgentStreamService, useValue: mockAgentStream },
        { provide: CheckpointService, useValue: mockCheckpoint },
        { provide: McpClientService, useValue: mockMcpClient },
        { provide: QueueService, useValue: mockQueueService },
        { provide: AgentCancellationService, useValue: mockCancellation },
        { provide: TurnResolverService, useValue: mockTurnResolver },
      ],
    }).compile();

    service = module.get<ApprovalFlowService>(ApprovalFlowService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('resolveApproval (Giai đoạn 3 — HITL, Step 5)', () => {
    const checkpoint = {
      id: 'checkpoint-1',
      replyMessageId: 'approval-msg-1',
      userId: 'user-1',
      botUserId: 'bot-1',
      channelId: 'channel-1',
      workspaceId: 'workspace-1',
      channelType: 'direct',
      originalPrompt: 'cập nhật status đơn OrderId=1 thành Completed',
      pendingTool: {
        provider: 'sql_server',
        name: 'execute_write_query',
        args: { query: "UPDATE Orders SET Status='Completed' WHERE OrderId=1" },
      },
      pendingTask: 'cập nhật status đơn OrderId=1',
      roundsSoFar: [
        {
          agent: 'sql_server',
          task: 'tìm đơn OrderId=1',
          result: 'Đơn OrderId=1 đang Pending',
        },
      ],
      history: [],
    };

    it('reject: marks the checkpoint rejected, edits the message, does NOT run the tool', async () => {
      mockCheckpoint.findPendingByReplyMessageId.mockResolvedValue(checkpoint);

      await service.resolveApproval({
        userId: 'user-1',
        messageId: 'approval-msg-1',
        action: 'reject',
      });

      expect(mockCheckpoint.claim).toHaveBeenCalledWith({
        id: 'checkpoint-1',
        toStatus: OrchestrationCheckpointStatus.REJECTED,
      });
      expect(mockMessageClient.updateMessage).toHaveBeenCalledWith({
        id: 'approval-msg-1',
        userId: 'bot-1',
        content: '❌ Đã huỷ theo yêu cầu.',
      });
      expect(mockMcpClient.callTool).not.toHaveBeenCalled();
      expect(mockAgentStream.emitStep).toHaveBeenCalledWith(
        {
          userId: 'user-1',
          channelId: 'channel-1',
          messageId: 'approval-msg-1',
          channelType: 'direct',
        },
        { type: 'done' },
      );
    });

    it('approve: claims the checkpoint then enqueues a background job instead of running the tool inline (fast HTTP response)', async () => {
      mockCheckpoint.findPendingByReplyMessageId.mockResolvedValue(checkpoint);

      await service.resolveApproval({
        userId: 'user-1',
        messageId: 'approval-msg-1',
        action: 'approve',
      });

      expect(mockCheckpoint.claim).toHaveBeenCalledWith({
        id: 'checkpoint-1',
        toStatus: OrchestrationCheckpointStatus.APPROVED,
      });
      // attempts:1 — mcpClient.callTool() không idempotent, không được để queue tự retry chạy lại tool THẬT lần 2.
      expect(mockQueueService.addJob).toHaveBeenCalledWith(
        EQueueName.AI_ORCHESTRATION_QUEUE,
        EJobName.PROCESS_APPROVAL,
        { checkpointId: 'checkpoint-1', userId: 'user-1' },
        { attempts: 1 },
      );
      expect(mockMcpClient.callTool).not.toHaveBeenCalled();
      expect(mockMessageClient.updateMessage).not.toHaveBeenCalled();
    });

    it('throws CHECKPOINT_NOT_FOUND when there is no pending checkpoint for this message', async () => {
      mockCheckpoint.findPendingByReplyMessageId.mockResolvedValue(null);

      await expect(
        service.resolveApproval({
          userId: 'user-1',
          messageId: 'unknown-msg',
          action: 'approve',
        }),
      ).rejects.toThrow();
      expect(mockCheckpoint.claim).not.toHaveBeenCalled();
    });

    it('throws CHECKPOINT_FORBIDDEN when the requester is not the user who triggered the turn', async () => {
      mockCheckpoint.findPendingByReplyMessageId.mockResolvedValue(checkpoint);

      await expect(
        service.resolveApproval({
          userId: 'some-other-user',
          messageId: 'approval-msg-1',
          action: 'approve',
        }),
      ).rejects.toThrow();
      expect(mockCheckpoint.claim).not.toHaveBeenCalled();
      expect(mockMcpClient.callTool).not.toHaveBeenCalled();
    });

    it('throws CHECKPOINT_ALREADY_RESOLVED and never runs the tool when another request already claimed it first (double-click / 2 tabs)', async () => {
      mockCheckpoint.findPendingByReplyMessageId.mockResolvedValue(checkpoint);
      mockCheckpoint.claim.mockResolvedValue({ claimed: false });

      await expect(
        service.resolveApproval({
          userId: 'user-1',
          messageId: 'approval-msg-1',
          action: 'approve',
        }),
      ).rejects.toThrow();
      expect(mockQueueService.addJob).not.toHaveBeenCalled();
      expect(mockMcpClient.callTool).not.toHaveBeenCalled();
      expect(mockMessageClient.updateMessage).not.toHaveBeenCalled();
    });
  });

  describe('processApprovalJob (Giai đoạn 3 — HITL, Step 5 — thực thi nền qua queue)', () => {
    const checkpoint = {
      id: 'checkpoint-1',
      replyMessageId: 'approval-msg-1',
      userId: 'user-1',
      botUserId: 'bot-1',
      channelId: 'channel-1',
      workspaceId: 'workspace-1',
      channelType: 'direct',
      originalPrompt: 'cập nhật status đơn OrderId=1 thành Completed',
      pendingTool: {
        provider: 'sql_server',
        name: 'execute_write_query',
        args: { query: "UPDATE Orders SET Status='Completed' WHERE OrderId=1" },
      },
      pendingTask: 'cập nhật status đơn OrderId=1',
      roundsSoFar: [
        {
          agent: 'sql_server',
          task: 'tìm đơn OrderId=1',
          result: 'Đơn OrderId=1 đang Pending',
        },
      ],
      history: [],
    };

    const runApprovalJob = (
      data: IProcessApprovalJobData = {
        checkpointId: 'checkpoint-1',
        userId: 'user-1',
      },
    ) => service.processApprovalJob(data);

    it('runs the real tool, then re-enters the Supervisor loop with the result folded into rounds — NOT resumed on the same agent', async () => {
      mockCheckpoint.findById.mockResolvedValue(checkpoint);
      mockMcpClient.callTool.mockResolvedValue({
        content: [{ type: 'text', text: 'raw mcp result' }],
      });
      (extractTextFromMcpResult as jest.Mock).mockReturnValue(
        '1 dòng đã được cập nhật.',
      );
      const agents = [
        { provider: 'sql_server', label: 'SQL Server', description: 'desc' },
      ];
      mockSupervisor.getAvailableAgents.mockResolvedValue(agents);
      mockTurnResolver.continueRounds.mockResolvedValue({
        content: 'Đã cập nhật đơn OrderId=1 thành Completed.',
        toolCalls: [
          { tool: 'sql_server.execute_write_query', status: 'success' },
        ],
      });

      await runApprovalJob();

      expect(mockCheckpoint.findById).toHaveBeenCalledWith({
        id: 'checkpoint-1',
      });
      expect(mockMcpClient.callTool).toHaveBeenCalledWith({
        provider: 'sql_server',
        name: 'execute_write_query',
        args: { query: "UPDATE Orders SET Status='Completed' WHERE OrderId=1" },
        ownerId: 'user-1',
      });
      // Chuyển UI sang "Đang tổng hợp..." TRƯỚC khi gọi lại Supervisor.
      expect(mockMessageClient.updateMessage).toHaveBeenCalledWith({
        id: 'approval-msg-1',
        userId: 'bot-1',
        content: '🤖 Đang tổng hợp kết quả...',
      });
      // Quay lại vòng lặp Supervisor với rounds đã gồm kết quả hành động vừa
      // duyệt — KHÔNG resume thẳng ReactLoop trên agent vừa dùng (bug cũ).
      expect(mockTurnResolver.continueRounds).toHaveBeenCalledWith(
        {
          userId: 'user-1',
          channelId: 'channel-1',
          workspaceId: 'workspace-1',
          messageId: 'approval-msg-1',
          botUserId: 'bot-1',
          channelType: 'direct',
        },
        'approval-msg-1',
        checkpoint.originalPrompt,
        agents,
        checkpoint.history,
        [
          ...checkpoint.roundsSoFar,
          {
            agent: 'sql_server',
            task: 'cập nhật status đơn OrderId=1',
            result: '1 dòng đã được cập nhật.',
          },
        ],
        [],
      );
      expect(mockMessageClient.updateMessage).toHaveBeenCalledWith({
        id: 'approval-msg-1',
        userId: 'bot-1',
        content: 'Đã cập nhật đơn OrderId=1 thành Completed.',
        toolCalls: [
          { tool: 'sql_server.execute_write_query', status: 'success' },
        ],
      });
      expect(mockAgentStream.emitStep).toHaveBeenCalledWith(expect.anything(), {
        type: 'done',
      });
    });

    it('caps an oversized tool result before folding it into the rounds passed to the Supervisor loop', async () => {
      mockCheckpoint.findById.mockResolvedValue(checkpoint);
      mockMcpClient.callTool.mockResolvedValue({
        content: [{ type: 'text', text: 'raw mcp result' }],
      });
      const hugeResult = 'x'.repeat(7000);
      (extractTextFromMcpResult as jest.Mock).mockReturnValue(hugeResult);

      await runApprovalJob();

      const roundsArg = mockTurnResolver.continueRounds.mock.calls[0][5];
      const foldedResult = roundsArg[roundsArg.length - 1].result;
      expect(foldedResult.length).toBeLessThan(hugeResult.length);
      expect(foldedResult).toContain('[truncated');
    });

    it('forwards whatever the Supervisor loop returns as-is (VD toolCalls: undefined) to the final message update', async () => {
      mockCheckpoint.findById.mockResolvedValue(checkpoint);
      mockMcpClient.callTool.mockResolvedValue({
        content: [{ type: 'text', text: 'raw mcp result' }],
      });
      (extractTextFromMcpResult as jest.Mock).mockReturnValue(
        '1 dòng đã được cập nhật.',
      );
      mockTurnResolver.continueRounds.mockResolvedValue({
        content: 'Đã cập nhật đơn OrderId=1 thành Completed.',
        toolCalls: undefined,
      });

      await runApprovalJob();

      expect(mockMessageClient.updateMessage).toHaveBeenCalledWith({
        id: 'approval-msg-1',
        userId: 'bot-1',
        content: 'Đã cập nhật đơn OrderId=1 thành Completed.',
        toolCalls: undefined,
      });
    });

    it('falls back to the raw error message if running the real tool fails, but still emits done', async () => {
      mockCheckpoint.findById.mockResolvedValue(checkpoint);
      mockMcpClient.callTool.mockRejectedValue(
        new Error('connect ECONNREFUSED'),
      );

      await runApprovalJob();

      expect(mockTurnResolver.continueRounds).not.toHaveBeenCalled();
      expect(mockMessageClient.updateMessage).toHaveBeenCalledWith({
        id: 'approval-msg-1',
        userId: 'bot-1',
        content: '⚠️ Lỗi: connect ECONNREFUSED',
      });
      expect(mockAgentStream.emitStep).toHaveBeenCalledWith(expect.anything(), {
        type: 'done',
      });
    });

    it('mục 6 — stops immediately and shows the tool error, WITHOUT re-entering the Supervisor loop, when the approved tool call itself resolves with isError (not a connect failure — that already throws and is handled separately)', async () => {
      mockCheckpoint.findById.mockResolvedValue(checkpoint);
      mockMcpClient.callTool.mockResolvedValue({
        content: [
          {
            type: 'text',
            text: 'Error [TOOL_EXECUTION_ERROR:append_document_text]: insufficient permission',
          },
        ],
        isError: true,
      });
      (extractTextFromMcpResult as jest.Mock).mockReturnValue(
        'Error [TOOL_EXECUTION_ERROR:append_document_text]: insufficient permission',
      );

      await runApprovalJob();

      // KHÔNG quay lại Supervisor — đây chính là bug thật đã gặp: Supervisor cứ
      // re-plan/thử lại đúng hành động này, destructiveHint lại yêu cầu duyệt,
      // lặp duyệt/lỗi nhiều lần.
      expect(mockTurnResolver.continueRounds).not.toHaveBeenCalled();
      expect(mockMessageClient.updateMessage).toHaveBeenCalledWith({
        id: 'approval-msg-1',
        userId: 'bot-1',
        content:
          '⚠️ Hành động "execute_write_query" đã được duyệt nhưng thực thi thất bại:\nError [TOOL_EXECUTION_ERROR:append_document_text]: insufficient permission',
      });
      expect(mockAgentStream.emitStep).toHaveBeenCalledWith(expect.anything(), {
        type: 'done',
      });
    });

    it('does not throw (and still emits done) when even the error-fallback updateMessage() call itself fails', async () => {
      mockCheckpoint.findById.mockResolvedValue(checkpoint);
      mockMcpClient.callTool.mockRejectedValue(
        new Error('connect ECONNREFUSED'),
      );
      mockMessageClient.updateMessage.mockRejectedValueOnce(
        new Error('message service unreachable'),
      );

      await expect(runApprovalJob()).resolves.toBeUndefined();

      expect(mockAgentStream.emitStep).toHaveBeenCalledWith(expect.anything(), {
        type: 'done',
      });
    });

    it('logs and returns quietly (does not throw) when the checkpoint can no longer be found', async () => {
      mockCheckpoint.findById.mockResolvedValue(null);

      await expect(runApprovalJob()).resolves.toBeUndefined();

      expect(mockMcpClient.callTool).not.toHaveBeenCalled();
      expect(mockMessageClient.updateMessage).not.toHaveBeenCalled();
    });

    it('Giai đoạn 4, Step 1 — claims execution BEFORE running the real tool, using the checkpoint id', async () => {
      mockCheckpoint.findById.mockResolvedValue(checkpoint);
      mockMcpClient.callTool.mockResolvedValue({
        content: [{ type: 'text', text: 'raw mcp result' }],
      });

      await runApprovalJob();

      expect(mockCheckpoint.claimExecution).toHaveBeenCalledWith({
        id: 'checkpoint-1',
      });
    });

    it('Giai đoạn 4, Step 1 — does NOT run the tool a second time when execution was already claimed (stalled/redelivered job)', async () => {
      mockCheckpoint.findById.mockResolvedValue(checkpoint);
      mockCheckpoint.claimExecution.mockResolvedValue({ claimed: false });

      await runApprovalJob();

      expect(mockMcpClient.callTool).not.toHaveBeenCalled();
      expect(mockTurnResolver.continueRounds).not.toHaveBeenCalled();
      expect(mockMessageClient.updateMessage).not.toHaveBeenCalled();
    });

    it('refreshes turn ownership before resuming, so Stop still works even if the original 15-min TTL already expired while the checkpoint sat pending', async () => {
      mockCheckpoint.findById.mockResolvedValue(checkpoint);
      mockMcpClient.callTool.mockResolvedValue({
        content: [{ type: 'text', text: 'raw mcp result' }],
      });

      await runApprovalJob();

      expect(mockCancellation.startTurn).toHaveBeenCalledWith(
        checkpoint.replyMessageId,
        'user-1',
      );
    });

    it('shows "Đã dừng theo yêu cầu" instead of a generic error when the Supervisor loop is cancelled mid-flight', async () => {
      mockCheckpoint.findById.mockResolvedValue(checkpoint);
      mockMcpClient.callTool.mockResolvedValue({
        content: [{ type: 'text', text: 'raw mcp result' }],
      });
      mockTurnResolver.continueRounds.mockRejectedValue(
        new TurnCancelledError(),
      );

      await runApprovalJob();

      expect(mockMessageClient.updateMessage).toHaveBeenCalledWith({
        id: checkpoint.replyMessageId,
        userId: checkpoint.botUserId,
        content: '⏹️ Đã dừng theo yêu cầu.',
      });
      expect(mockAgentStream.emitStep).toHaveBeenCalledWith(
        expect.objectContaining({ messageId: checkpoint.replyMessageId }),
        { type: 'done' },
      );
    });

    it('forwards a repeated approval-pause answer from the Supervisor loop the same as any other answer — no special-casing needed anymore', async () => {
      mockCheckpoint.findById.mockResolvedValue(checkpoint);
      mockMcpClient.callTool.mockResolvedValue({
        content: [{ type: 'text', text: 'Đơn OrderId=1 đã Completed.' }],
      });
      (extractTextFromMcpResult as jest.Mock).mockReturnValue(
        'Đơn OrderId=1 đã Completed.',
      );
      // TurnResolverService tự pause lần 2 (qua CheckpointPauseService) NẾU vòng
      // tiếp theo lại gặp 1 tool rủi ro khác — ApprovalFlowService không cần
      // biết chuyện đó xảy ra, chỉ forward đúng AnswerResult nhận được.
      mockTurnResolver.continueRounds.mockResolvedValue({
        content:
          '⏸️ Cần bạn duyệt 1 hành động trước khi tiếp tục — xem tin nhắn bên dưới.',
        toolCalls: undefined,
      });

      await runApprovalJob();

      expect(mockMessageClient.updateMessage).toHaveBeenCalledWith({
        id: checkpoint.replyMessageId,
        userId: checkpoint.botUserId,
        content:
          '⏸️ Cần bạn duyệt 1 hành động trước khi tiếp tục — xem tin nhắn bên dưới.',
        toolCalls: undefined,
      });
    });
  });
});
