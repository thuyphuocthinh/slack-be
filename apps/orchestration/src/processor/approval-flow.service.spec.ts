import { Test, TestingModule } from '@nestjs/testing';
import { EJobName, EQueueName, IProcessApprovalJobData, QueueService } from '@slack/queue';
import { ApprovalFlowService } from './approval-flow.service';
import { MessageClientService } from '../message-client.service';
import { ReactLoopService } from '../llm/react-loop.service';
import { SupervisorService } from '../llm/supervisor.service';
import { AgentStreamService } from '../socket/agent-stream.service';
import { CheckpointService } from '../checkpoint/checkpoint.service';
import { ApprovalRequiredError } from '../llm/approval-required.error';
import { McpClientService } from '../mcp/mcp-client.service';
import { OrchestrationCheckpointStatus } from '../entity/orchestration-checkpoint.entity';
import { AgentCancellationService } from '../cancellation/agent-cancellation.service';
import { TurnCancelledError } from '../llm/turn-cancelled.error';
import { CheckpointPauseService } from './checkpoint-pause.service';

// approval-flow.service.ts import @slack/common ở module scope (extractTextFromMcpResult)
// — mock thẳng barrel để tránh kéo theo "nanoid" (ESM-only) mà jest không transform được.
jest.mock('@slack/common', () => ({ extractTextFromMcpResult: jest.fn() }));
import { extractTextFromMcpResult } from '@slack/common';

describe('ApprovalFlowService', () => {
  let service: ApprovalFlowService;

  const mockMessageClient = { updateMessage: jest.fn() };
  const mockReactLoop = { run: jest.fn() };
  const mockSupervisor = { synthesize: jest.fn() };
  const mockAgentStream = { emitStep: jest.fn() };
  const mockCheckpoint = {
    findPendingByReplyMessageId: jest.fn(),
    findById: jest.fn(),
    claim: jest.fn(),
    claimExecution: jest.fn(),
  };
  const mockMcpClient = { callTool: jest.fn() };
  const mockQueueService = { addJob: jest.fn() };
  const mockCancellation = {
    startTurn: jest.fn(),
    isCancelled: jest.fn().mockResolvedValue(false),
  };
  const mockCheckpointPause = { pauseForApproval: jest.fn() };

  beforeEach(async () => {
    mockMessageClient.updateMessage.mockResolvedValue(undefined);
    mockAgentStream.emitStep.mockResolvedValue(undefined);
    mockCheckpoint.claim.mockResolvedValue({ claimed: true });
    mockCheckpoint.claimExecution.mockResolvedValue({ claimed: true });
    mockQueueService.addJob.mockResolvedValue({ id: 'job-1' });
    mockCancellation.isCancelled.mockResolvedValue(false);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ApprovalFlowService,
        { provide: MessageClientService, useValue: mockMessageClient },
        { provide: ReactLoopService, useValue: mockReactLoop },
        { provide: SupervisorService, useValue: mockSupervisor },
        { provide: AgentStreamService, useValue: mockAgentStream },
        { provide: CheckpointService, useValue: mockCheckpoint },
        { provide: McpClientService, useValue: mockMcpClient },
        { provide: QueueService, useValue: mockQueueService },
        { provide: AgentCancellationService, useValue: mockCancellation },
        { provide: CheckpointPauseService, useValue: mockCheckpointPause },
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

    it('reject: marks the checkpoint rejected, edits the message, does NOT run the tool or ReactLoop', async () => {
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
      expect(mockReactLoop.run).not.toHaveBeenCalled();
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
      expect(mockReactLoop.run).not.toHaveBeenCalled();
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
      expect(mockReactLoop.run).not.toHaveBeenCalled();
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

    it('runs the real tool, resumes ReactLoop with the result folded in, synthesizes with prior rounds, and updates the message', async () => {
      mockCheckpoint.findById.mockResolvedValue(checkpoint);
      mockMcpClient.callTool.mockResolvedValue({
        content: [{ type: 'text', text: 'raw mcp result' }],
      });
      (extractTextFromMcpResult as jest.Mock).mockReturnValue(
        '1 dòng đã được cập nhật.',
      );
      mockReactLoop.run.mockResolvedValue({
        answer: 'Đơn OrderId=1 đã Completed.',
        toolCalls: [
          { tool: 'sql_server.execute_write_query', status: 'success' },
        ],
      });
      mockSupervisor.synthesize.mockResolvedValue(
        'Đã cập nhật đơn OrderId=1 thành Completed.',
      );

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

      const resumeCallArg = mockReactLoop.run.mock.calls[0][0];
      expect(resumeCallArg.provider).toBe('sql_server');
      expect(resumeCallArg.prompt).toContain('1 dòng đã được cập nhật.');
      expect(resumeCallArg.history).toEqual([]);

      expect(mockSupervisor.synthesize).toHaveBeenCalledWith(
        checkpoint.originalPrompt,
        [
          ...checkpoint.roundsSoFar,
          {
            agent: 'sql_server',
            task: 'cập nhật status đơn OrderId=1',
            result: 'Đơn OrderId=1 đã Completed.',
          },
        ],
        expect.any(Function),
        expect.anything(),
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

    it('sends toolCalls=undefined (not an empty array) when the resumed ReactLoop needed no further tool calls', async () => {
      mockCheckpoint.findById.mockResolvedValue(checkpoint);
      mockMcpClient.callTool.mockResolvedValue({
        content: [{ type: 'text', text: 'raw mcp result' }],
      });
      (extractTextFromMcpResult as jest.Mock).mockReturnValue(
        '1 dòng đã được cập nhật.',
      );
      mockReactLoop.run.mockResolvedValue({
        answer: 'Đơn OrderId=1 đã Completed.',
        toolCalls: [],
      });
      mockSupervisor.synthesize.mockResolvedValue(
        'Đã cập nhật đơn OrderId=1 thành Completed.',
      );

      await runApprovalJob();

      expect(mockMessageClient.updateMessage).toHaveBeenCalledWith({
        id: 'approval-msg-1',
        userId: 'bot-1',
        content: 'Đã cập nhật đơn OrderId=1 thành Completed.',
        toolCalls: undefined,
      });
    });

    it('falls back to the raw error message if running the real tool (or resume) fails, but still emits done', async () => {
      mockCheckpoint.findById.mockResolvedValue(checkpoint);
      mockMcpClient.callTool.mockRejectedValue(new Error('connect ECONNREFUSED'));

      await runApprovalJob();

      expect(mockMessageClient.updateMessage).toHaveBeenCalledWith({
        id: 'approval-msg-1',
        userId: 'bot-1',
        content: '⚠️ Lỗi: connect ECONNREFUSED',
      });
      expect(mockAgentStream.emitStep).toHaveBeenCalledWith(expect.anything(), {
        type: 'done',
      });
    });

    it('does not throw (and still emits done) when even the error-fallback updateMessage() call itself fails', async () => {
      mockCheckpoint.findById.mockResolvedValue(checkpoint);
      mockMcpClient.callTool.mockRejectedValue(new Error('connect ECONNREFUSED'));
      mockMessageClient.updateMessage.mockRejectedValue(
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
      mockReactLoop.run.mockResolvedValue({ answer: 'ok', toolCalls: [] });
      mockSupervisor.synthesize.mockResolvedValue('ok');

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
      expect(mockReactLoop.run).not.toHaveBeenCalled();
      expect(mockMessageClient.updateMessage).not.toHaveBeenCalled();
    });

    it('refreshes turn ownership before resuming, so Stop still works even if the original 15-min TTL already expired while the checkpoint sat pending', async () => {
      mockCheckpoint.findById.mockResolvedValue(checkpoint);
      mockMcpClient.callTool.mockResolvedValue({
        content: [{ type: 'text', text: 'raw mcp result' }],
      });
      mockReactLoop.run.mockResolvedValue({ answer: 'ok', toolCalls: [] });
      mockSupervisor.synthesize.mockResolvedValue('ok');

      await runApprovalJob();

      expect(mockCancellation.startTurn).toHaveBeenCalledWith(
        checkpoint.replyMessageId,
        'user-1',
      );
    });

    it('shows "Đã dừng theo yêu cầu" instead of a generic error when the resumed turn is cancelled mid-flight', async () => {
      mockCheckpoint.findById.mockResolvedValue(checkpoint);
      mockReactLoop.run.mockRejectedValue(new TurnCancelledError());

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

    it('pauses for a SECOND approval (new checkpoint) instead of crashing when the resumed turn hits another destructive tool', async () => {
      mockCheckpoint.findById.mockResolvedValue(checkpoint);
      mockMcpClient.callTool.mockResolvedValue({
        content: [{ type: 'text', text: 'Đơn OrderId=1 đã Completed.' }],
      });
      (extractTextFromMcpResult as jest.Mock).mockReturnValue(
        'Đơn OrderId=1 đã Completed.',
      );

      const secondPendingTool = {
        provider: 'sql_server',
        name: 'execute_write_query',
        args: { query: "UPDATE Orders SET Status='Shipped' WHERE OrderId=2" },
      };
      mockReactLoop.run.mockRejectedValue(
        new ApprovalRequiredError(secondPendingTool, [
          { tool: 'sql_server.execute_write_query', status: 'success' },
        ]),
      );
      mockCheckpointPause.pauseForApproval.mockResolvedValue({
        content: '⏸️ Cần bạn duyệt 1 hành động trước khi tiếp tục — xem tin nhắn bên dưới.',
        toolCalls: undefined,
      });

      await runApprovalJob();

      // Checkpoint MỚI được uỷ quyền cho CheckpointPauseService, với roundsSoFar
      // gồm round cũ + kết quả hành động vừa duyệt/chạy
      expect(mockCheckpointPause.pauseForApproval).toHaveBeenCalledWith(
        {
          userId: 'user-1',
          channelId: checkpoint.channelId,
          workspaceId: checkpoint.workspaceId,
          messageId: checkpoint.replyMessageId,
          botUserId: checkpoint.botUserId,
          channelType: checkpoint.channelType,
        },
        checkpoint.originalPrompt,
        [
          ...checkpoint.roundsSoFar,
          {
            agent: checkpoint.pendingTool.provider,
            task: checkpoint.pendingTask,
            result: 'Đơn OrderId=1 đã Completed.',
          },
        ],
        [{ tool: 'sql_server.execute_write_query', status: 'success' }],
        checkpoint.history,
        {
          approvalRequired: secondPendingTool,
          task: checkpoint.pendingTask,
          toolCalls: [{ tool: 'sql_server.execute_write_query', status: 'success' }],
        },
      );
      // Message cũ ("Đang tổng hợp...") được thay bằng lời nhắc chờ duyệt tiếp
      expect(mockMessageClient.updateMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          id: checkpoint.replyMessageId,
          content: expect.stringContaining('Cần bạn duyệt'),
        }),
      );
      // KHÔNG rơi vào nhánh lỗi chung — không hiện message lỗi nội bộ ra UI
      expect(mockMessageClient.updateMessage).not.toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('Approval required for tool'),
        }),
      );
    });
  });
});
