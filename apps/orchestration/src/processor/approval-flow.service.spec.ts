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
import { ORCHESTRATION_CONSTANTS } from '@slack/constants';
import { LlmStrategyFactory } from '../llm/strategy/llm-strategy.factory';
import { CircuitBreakerService } from '../common/circuit-breaker.service';
import { MemoryManagerService } from '../memory/memory-manager.service';
import { SkillService } from '../memory/skill.service';
import { SkillRetrievalService } from '../memory/skill-retrieval.service';
import { resolveDataCharBudget } from '../executor/tool-result-size-cap.util';

// approval-flow.service.ts import @slack/common ở module scope (extractTextFromMcpResult)
// — mock thẳng barrel để tránh kéo theo "nanoid" (ESM-only) mà jest không transform được.
jest.mock('@slack/common', () => ({ extractTextFromMcpResult: jest.fn() }));
import { extractTextFromMcpResult } from '@slack/common';

describe('ApprovalFlowService', () => {
  let service: ApprovalFlowService;

  const mockMessageClient = {
    updateMessage: jest.fn(),
    tryUpdateMessage: jest.fn(),
  };
  const mockSupervisor = { getAvailableAgents: jest.fn() };
  const mockAgentStream = { emitStep: jest.fn() };
  const mockCheckpoint = {
    findPendingByReplyMessageId: jest.fn(),
    findById: jest.fn(),
    claim: jest.fn(),
    claimExecution: jest.fn(),
    markToolExecuted: jest.fn(),
    revertApprovedClaim: jest.fn(),
  };
  const mockMcpClient = { callTool: jest.fn() };
  const mockQueueService = { addJob: jest.fn() };
  const mockCancellation = { startTurn: jest.fn() };
  const mockTurnResolver = { continueRounds: jest.fn() };
  const mockStrategy = { id: 'openai', generateStructured: jest.fn() };
  const mockLlmFactory = { resolve: jest.fn() };
  const mockCircuitBreaker = {
    run: jest.fn((_key: string, action: () => Promise<unknown>) => action()),
  };
  const mockMemoryManager = {
    buildBudget: jest.fn((modelId: string) => ({
      toolResultCharBudget: resolveDataCharBudget(modelId),
      memoryCharBudget: 0,
      historyCharBudget: 0,
    })),
    getMemories: jest.fn().mockResolvedValue([]),
  };
  const mockSkillService = {
    create: jest.fn().mockResolvedValue(undefined),
    incrementApprovedRunCount: jest.fn().mockResolvedValue(undefined),
  };
  // Mặc định null — mọi test đã có từ trước (không liên quan Skill Library)
  // không bị ảnh hưởng (recordSkillOutcome() sẽ tự tạo skill mới, không throw).
  const mockSkillRetrieval = {
    findSimilarForAcquisition: jest.fn().mockResolvedValue(null),
  };

  beforeEach(async () => {
    mockMessageClient.updateMessage.mockResolvedValue(undefined);
    mockMessageClient.tryUpdateMessage.mockResolvedValue(undefined);
    mockAgentStream.emitStep.mockResolvedValue(undefined);
    mockCheckpoint.claim.mockResolvedValue({ claimed: true });
    mockCheckpoint.claimExecution.mockResolvedValue({ claimed: true });
    mockCheckpoint.markToolExecuted.mockResolvedValue(undefined);
    mockCheckpoint.revertApprovedClaim.mockResolvedValue(undefined);
    mockQueueService.addJob.mockResolvedValue({ id: 'job-1' });
    mockSupervisor.getAvailableAgents.mockResolvedValue([]);
    mockTurnResolver.continueRounds.mockResolvedValue({
      content: 'ok',
      toolCalls: undefined,
    });
    mockLlmFactory.resolve.mockReturnValue({
      strategy: mockStrategy,
      model: 'gpt-4o-mini',
    });
    // Mặc định: task không nêu số lượng cụ thể — mọi test đã có từ trước
    // (không liên quan quantity-check) không bị ảnh hưởng.
    mockStrategy.generateStructured.mockResolvedValue({ requiredCount: 0 });
    mockSkillRetrieval.findSimilarForAcquisition.mockResolvedValue(null);

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
        { provide: LlmStrategyFactory, useValue: mockLlmFactory },
        { provide: CircuitBreakerService, useValue: mockCircuitBreaker },
        { provide: MemoryManagerService, useValue: mockMemoryManager },
        { provide: SkillService, useValue: mockSkillService },
        { provide: SkillRetrievalService, useValue: mockSkillRetrieval },
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
      kind: 'approval' as const,
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

    it('edit_and_approve: correctly validates and passes updated pending tool to claim()', async () => {
      mockCheckpoint.findPendingByReplyMessageId.mockResolvedValue(checkpoint);

      await service.resolveApproval({
        userId: 'user-1',
        messageId: 'approval-msg-1',
        action: 'edit_and_approve',
        editedArgs: {
          query: "UPDATE Orders SET Status='Shipped' WHERE OrderId=1",
        },
      });

      expect(mockCheckpoint.claim).toHaveBeenCalledWith({
        id: 'checkpoint-1',
        toStatus: OrchestrationCheckpointStatus.APPROVED,
        updatedPendingTool: {
          provider: 'sql_server',
          name: 'execute_write_query',
          args: { query: "UPDATE Orders SET Status='Shipped' WHERE OrderId=1" },
        },
      });
      expect(mockQueueService.addJob).toHaveBeenCalled();
    });

    it('edit_and_approve: rejects if attempting to add new unknown keys to args', async () => {
      mockCheckpoint.findPendingByReplyMessageId.mockResolvedValue(checkpoint);

      await expect(
        service.resolveApproval({
          userId: 'user-1',
          messageId: 'approval-msg-1',
          action: 'edit_and_approve',
          editedArgs: {
            query: "UPDATE Orders SET Status='Shipped' WHERE OrderId=1",
            malicious_new_key: 'hacked',
          },
        }),
      ).rejects.toThrow();

      expect(mockCheckpoint.claim).not.toHaveBeenCalled();
    });

    it('edit_and_approve: rejects if attempting to inject forbidden values', async () => {
      mockCheckpoint.findPendingByReplyMessageId.mockResolvedValue(checkpoint);

      await expect(
        service.resolveApproval({
          userId: 'user-1',
          messageId: 'approval-msg-1',
          action: 'edit_and_approve',
          editedArgs: { query: '' }, // empty string is forbidden in validation
        }),
      ).rejects.toThrow();

      expect(mockCheckpoint.claim).not.toHaveBeenCalled();
    });

    it('approve: reverts the claim back to PENDING when enqueueing the job fails, instead of leaving it stuck APPROVED forever', async () => {
      mockCheckpoint.findPendingByReplyMessageId.mockResolvedValue(checkpoint);
      mockQueueService.addJob.mockRejectedValue(new Error('redis unreachable'));

      await expect(
        service.resolveApproval({
          userId: 'user-1',
          messageId: 'approval-msg-1',
          action: 'approve',
        }),
      ).rejects.toThrow();

      expect(mockCheckpoint.revertApprovedClaim).toHaveBeenCalledWith({
        id: 'checkpoint-1',
      });
      expect(mockMcpClient.callTool).not.toHaveBeenCalled();
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

    it('accuracy_problem.md mục 1 — clarify: claims with selectedProvider then enqueues the same background job as approve', async () => {
      const clarificationCheckpoint = {
        ...checkpoint,
        kind: 'clarification' as const,
      };
      mockCheckpoint.findPendingByReplyMessageId.mockResolvedValue(
        clarificationCheckpoint,
      );

      await service.resolveApproval({
        userId: 'user-1',
        messageId: 'approval-msg-1',
        action: 'clarify',
        selectedProvider: 'notion',
      });

      expect(mockCheckpoint.claim).toHaveBeenCalledWith({
        id: 'checkpoint-1',
        toStatus: OrchestrationCheckpointStatus.APPROVED,
        selectedProvider: 'notion',
      });
      expect(mockQueueService.addJob).toHaveBeenCalledWith(
        EQueueName.AI_ORCHESTRATION_QUEUE,
        EJobName.PROCESS_APPROVAL,
        { checkpointId: 'checkpoint-1', userId: 'user-1' },
        { attempts: 1 },
      );
    });

    it('throws CHECKPOINT_ACTION_MISMATCH when action="clarify" but the checkpoint kind is "approval"', async () => {
      mockCheckpoint.findPendingByReplyMessageId.mockResolvedValue(checkpoint);

      await expect(
        service.resolveApproval({
          userId: 'user-1',
          messageId: 'approval-msg-1',
          action: 'clarify',
          selectedProvider: 'notion',
        }),
      ).rejects.toThrow();
      expect(mockCheckpoint.claim).not.toHaveBeenCalled();
    });

    it('throws CHECKPOINT_ACTION_MISMATCH when action="clarify" but selectedProvider is missing', async () => {
      const clarificationCheckpoint = {
        ...checkpoint,
        kind: 'clarification' as const,
      };
      mockCheckpoint.findPendingByReplyMessageId.mockResolvedValue(
        clarificationCheckpoint,
      );

      await expect(
        service.resolveApproval({
          userId: 'user-1',
          messageId: 'approval-msg-1',
          action: 'clarify',
        }),
      ).rejects.toThrow();
      expect(mockCheckpoint.claim).not.toHaveBeenCalled();
    });

    it('throws CHECKPOINT_ACTION_MISMATCH when action="approve" but the checkpoint kind is "clarification"', async () => {
      const clarificationCheckpoint = {
        ...checkpoint,
        kind: 'clarification' as const,
      };
      mockCheckpoint.findPendingByReplyMessageId.mockResolvedValue(
        clarificationCheckpoint,
      );

      await expect(
        service.resolveApproval({
          userId: 'user-1',
          messageId: 'approval-msg-1',
          action: 'approve',
        }),
      ).rejects.toThrow();
      expect(mockCheckpoint.claim).not.toHaveBeenCalled();
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
      kind: 'approval' as const,
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
        undefined,
        // accuracy_problem.md mục 9.2 — fixture `checkpoint` ở trên không set
        // remainingSteps => destructure ra undefined, truyền nguyên vậy xuống.
        undefined,
      );
      expect(mockMessageClient.updateMessage).toHaveBeenCalledWith({
        id: 'approval-msg-1',
        userId: 'bot-1',
        channelId: 'channel-1',
        content: 'Đã cập nhật đơn OrderId=1 thành Completed.',
        toolCalls: [
          { tool: 'sql_server.execute_write_query', status: 'success' },
        ],
      });
      expect(mockAgentStream.emitStep).toHaveBeenCalledWith(expect.anything(), {
        type: 'done',
      });
      expect(mockCheckpoint.markToolExecuted).toHaveBeenCalledWith({
        id: 'checkpoint-1',
      });
    });

    it('caps an oversized tool result before folding it into the rounds passed to the Supervisor loop', async () => {
      mockCheckpoint.findById.mockResolvedValue(checkpoint);
      mockMcpClient.callTool.mockResolvedValue({
        content: [{ type: 'text', text: 'raw mcp result' }],
      });
      // accuracy_problem.md mục 5 — budget giờ tính THEO model thật
      // (gpt-4o-mini ~153.600 ký tự), không còn hằng số cứng 6000 — dữ liệu
      // phải vượt XA budget mới để còn kiểm được hành vi cap.
      const hugeResult = 'x'.repeat(160_000);
      (extractTextFromMcpResult as jest.Mock).mockReturnValue(hugeResult);

      await runApprovalJob();

      const roundsArg = mockTurnResolver.continueRounds.mock.calls[0][5];
      const foldedResult = roundsArg[roundsArg.length - 1].result;
      expect(foldedResult.length).toBeLessThan(hugeResult.length);
      expect(foldedResult).toContain('[truncated');
    });

    it('accuracy_problem.md mục 5 — KHÔNG cắt kết quả tool cỡ thật (VD 500 dòng SQL, ~40k ký tự) sau khi đã được duyệt', async () => {
      mockCheckpoint.findById.mockResolvedValue(checkpoint);
      mockMcpClient.callTool.mockResolvedValue({
        content: [{ type: 'text', text: 'raw mcp result' }],
      });
      const fiveHundredRows = JSON.stringify(
        Array.from({ length: 500 }, (_, i) => ({
          id: i,
          name: `Khách hàng ${i}`,
          email: `customer${i}@example.com`,
        })),
      );
      (extractTextFromMcpResult as jest.Mock).mockReturnValue(fiveHundredRows);

      await runApprovalJob();

      const roundsArg = mockTurnResolver.continueRounds.mock.calls[0][5];
      const foldedResult = roundsArg[roundsArg.length - 1].result;
      expect(foldedResult).toContain('"id":0');
      expect(foldedResult).toContain('"id":499');
      expect(foldedResult).not.toContain('truncated');
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
        channelId: 'channel-1',
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
      expect(mockMessageClient.tryUpdateMessage).toHaveBeenCalledWith({
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
      expect(mockCheckpoint.markToolExecuted).not.toHaveBeenCalled();
    });

    it("reports the error via tryUpdateMessage() (not the throwing updateMessage()) — resilience to a double-failure is MessageClientService.tryUpdateMessage()'s own responsibility, see message-client.service.spec.ts", async () => {
      mockCheckpoint.findById.mockResolvedValue(checkpoint);
      mockMcpClient.callTool.mockRejectedValue(
        new Error('connect ECONNREFUSED'),
      );

      await expect(runApprovalJob()).resolves.toBeUndefined();

      expect(mockMessageClient.tryUpdateMessage).toHaveBeenCalledWith({
        id: 'approval-msg-1',
        userId: 'bot-1',
        content: '⚠️ Lỗi: connect ECONNREFUSED',
      });
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

      expect(mockMessageClient.tryUpdateMessage).toHaveBeenCalledWith({
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
        channelId: checkpoint.channelId,
        content:
          '⏸️ Cần bạn duyệt 1 hành động trước khi tiếp tục — xem tin nhắn bên dưới.',
        toolCalls: undefined,
      });
    });
  });

  describe('quantity-check after approval (ver3.md mục 3)', () => {
    const checkpoint = {
      id: 'checkpoint-1',
      replyMessageId: 'approval-msg-1',
      userId: 'user-1',
      botUserId: 'bot-1',
      channelId: 'channel-1',
      workspaceId: 'workspace-1',
      channelType: 'direct',
      originalPrompt: 'Tạo 5 sản phẩm ngẫu nhiên rồi chèn vào bảng Products',
      pendingTool: {
        provider: 'sql_server',
        name: 'execute_write_query',
        args: { query: "INSERT INTO Products VALUES ('A')" },
      },
      pendingTask: 'Tạo 5 sản phẩm ngẫu nhiên rồi chèn vào bảng Products',
      roundsSoFar: [],
      history: [],
      kind: 'approval' as const,
    };

    const runApprovalJob = () =>
      service.processApprovalJob({
        checkpointId: 'checkpoint-1',
        userId: 'user-1',
      });

    beforeEach(() => {
      mockCheckpoint.findById.mockResolvedValue(checkpoint);
      mockMcpClient.callTool.mockResolvedValue({
        content: [{ type: 'text', text: 'raw' }],
      });
      (extractTextFromMcpResult as jest.Mock).mockReturnValue('1 row inserted');
    });

    it('prepends a continuation step when the achieved count falls short', async () => {
      mockStrategy.generateStructured
        .mockResolvedValueOnce({ requiredCount: 5 })
        .mockResolvedValueOnce({ achievedCount: 1 });

      await runApprovalJob();

      const remainingSteps = mockTurnResolver.continueRounds.mock.calls[0][8];
      expect(remainingSteps).toHaveLength(1);
      expect(remainingSteps[0].agent).toBe('sql_server');
      expect(remainingSteps[0].task).toContain('Đã xử lý 1/5');
    });

    it('tells the model to batch the remaining rows into a single tool call (manual_test_bank.md V1/V2 — avoid 1 approval round per row)', async () => {
      mockStrategy.generateStructured
        .mockResolvedValueOnce({ requiredCount: 20 })
        .mockResolvedValueOnce({ achievedCount: 1 });

      await runApprovalJob();

      const remainingSteps = mockTurnResolver.continueRounds.mock.calls[0][8];
      expect(remainingSteps[0].task).toContain(
        'gộp TOÀN BỘ 19 phần còn thiếu vào ĐÚNG 1 lần gọi tool duy nhất',
      );
    });

    it('leaves remainingSteps untouched when the achieved count already matches', async () => {
      mockStrategy.generateStructured
        .mockResolvedValueOnce({ requiredCount: 5 })
        .mockResolvedValueOnce({ achievedCount: 5 });

      await runApprovalJob();

      expect(mockTurnResolver.continueRounds.mock.calls[0][8]).toEqual(
        checkpoint.remainingSteps,
      );
    });

    it('does not count an UNRELATED earlier round using the same agent toward the continuation cap (bug fix)', async () => {
      const checkpointWithUnrelatedRound = {
        ...checkpoint,
        roundsSoFar: [
          {
            agent: 'sql_server',
            task: 'kiểm tra số lượng khách hàng inactive',
            result: '120 khách hàng',
          },
        ],
      };
      mockCheckpoint.findById.mockResolvedValue(checkpointWithUnrelatedRound);
      mockStrategy.generateStructured
        .mockResolvedValueOnce({ requiredCount: 5 })
        .mockResolvedValueOnce({ achievedCount: 1 });

      await runApprovalJob();

      // Round không liên quan (task khác hẳn) KHÔNG được tính vào "đã thử mấy
      // lần" — vẫn còn dư budget để chèn tiếp, không chạm cap ngay lập tức.
      const remainingSteps = mockTurnResolver.continueRounds.mock.calls[0][8];
      expect(remainingSteps).toHaveLength(1);
      expect(remainingSteps[0].task).toContain('Đã xử lý 1/5');
    });

    it('stops nudging once MAX_QUANTITY_CONTINUATION_ROUNDS is reached, but still warns instead of silently claiming done', async () => {
      const priorAttempts =
        ORCHESTRATION_CONSTANTS.MAX_QUANTITY_CONTINUATION_ROUNDS - 1;
      const stuckCheckpoint = {
        ...checkpoint,
        roundsSoFar: Array.from({ length: priorAttempts }, () => ({
          agent: 'sql_server',
          task: checkpoint.pendingTask,
          result: '1',
        })),
      };
      mockCheckpoint.findById.mockResolvedValue(stuckCheckpoint);
      mockStrategy.generateStructured
        .mockResolvedValueOnce({ requiredCount: 5 })
        .mockResolvedValueOnce({ achievedCount: 1 });

      await runApprovalJob();

      const roundsArg = mockTurnResolver.continueRounds.mock.calls[0][5];
      expect(roundsArg[roundsArg.length - 1].result).toContain(
        `mới xử lý được 1 sau ${ORCHESTRATION_CONSTANTS.MAX_QUANTITY_CONTINUATION_ROUNDS} lần thử`,
      );
      expect(mockTurnResolver.continueRounds.mock.calls[0][8]).toEqual(
        stuckCheckpoint.remainingSteps,
      );
    });
  });

  describe('processApprovalJob — resolveClarificationCheckpoint (accuracy_problem.md mục 1)', () => {
    const clarificationCheckpoint = {
      id: 'checkpoint-2',
      replyMessageId: 'clarification-msg-1',
      userId: 'user-1',
      botUserId: 'bot-1',
      channelId: 'channel-1',
      workspaceId: 'workspace-1',
      channelType: 'direct',
      originalPrompt: 'lưu thông tin này lại giúp tôi',
      pendingTool: null,
      pendingTask: 'lưu thông tin này lại',
      roundsSoFar: [],
      history: [],
      kind: 'clarification' as const,
      clarificationQuestion: 'Bạn muốn dùng "Google Docs" hay "Notion"?',
      clarificationCandidates: [
        { provider: 'google_docs', label: 'Google Docs' },
        { provider: 'notion', label: 'Notion' },
      ],
      selectedProvider: 'notion',
    };

    const runApprovalJob = (
      data: IProcessApprovalJobData = {
        checkpointId: 'checkpoint-2',
        userId: 'user-1',
      },
    ) => service.processApprovalJob(data);

    it('forces the selected agent into the pending step and resumes continueRounds() — does NOT call any tool directly', async () => {
      mockCheckpoint.findById.mockResolvedValue(clarificationCheckpoint);
      const agents = [
        { provider: 'notion', label: 'Notion', description: 'desc' },
      ];
      mockSupervisor.getAvailableAgents.mockResolvedValue(agents);
      mockTurnResolver.continueRounds.mockResolvedValue({
        content: 'Đã lưu vào Notion.',
        toolCalls: [],
      });

      await runApprovalJob();

      expect(mockMcpClient.callTool).not.toHaveBeenCalled();
      expect(mockMessageClient.updateMessage).toHaveBeenCalledWith({
        id: 'clarification-msg-1',
        userId: 'bot-1',
        content: '🤖 Đang tổng hợp kết quả...',
      });
      expect(mockTurnResolver.continueRounds).toHaveBeenCalledWith(
        {
          userId: 'user-1',
          channelId: 'channel-1',
          workspaceId: 'workspace-1',
          messageId: 'clarification-msg-1',
          botUserId: 'bot-1',
          channelType: 'direct',
        },
        'clarification-msg-1',
        'lưu thông tin này lại giúp tôi',
        agents,
        [],
        [],
        [],
        { agent: 'notion', task: 'lưu thông tin này lại' },
        // accuracy_problem.md mục 9.2 — fixture `clarificationCheckpoint` ở
        // trên không set remainingSteps => destructure ra undefined.
        undefined,
      );
      expect(mockMessageClient.updateMessage).toHaveBeenCalledWith({
        id: 'clarification-msg-1',
        userId: 'bot-1',
        channelId: 'channel-1',
        content: 'Đã lưu vào Notion.',
        toolCalls: [],
      });
    });

    it('accuracy_problem.md mục 9.2 — forwards the checkpoint remainingSteps (B, C after the ambiguous step) into continueRounds() so they are not lost', async () => {
      const remainingSteps = [
        { agent: 'sql_server', task: 'ghi log vào bảng logs' },
      ];
      mockCheckpoint.findById.mockResolvedValue({
        ...clarificationCheckpoint,
        remainingSteps,
      });
      const agents = [
        { provider: 'notion', label: 'Notion', description: 'desc' },
        { provider: 'sql_server', label: 'SQL Server', description: 'desc' },
      ];
      mockSupervisor.getAvailableAgents.mockResolvedValue(agents);
      mockTurnResolver.continueRounds.mockResolvedValue({
        content: 'Đã lưu vào Notion và ghi log.',
        toolCalls: [],
      });

      await runApprovalJob();

      expect(mockTurnResolver.continueRounds).toHaveBeenCalledWith(
        expect.anything(),
        'clarification-msg-1',
        'lưu thông tin này lại giúp tôi',
        agents,
        [],
        [],
        [],
        { agent: 'notion', task: 'lưu thông tin này lại' },
        remainingSteps,
      );
    });

    it('keeps the "done" signal + Stop/cancel handling identical to approveCheckpoint()', async () => {
      mockCheckpoint.findById.mockResolvedValue(clarificationCheckpoint);
      mockSupervisor.getAvailableAgents.mockResolvedValue([]);
      mockTurnResolver.continueRounds.mockRejectedValue(
        new TurnCancelledError('phần đã có'),
      );

      await runApprovalJob();

      expect(mockMessageClient.tryUpdateMessage).toHaveBeenCalledWith({
        id: 'clarification-msg-1',
        userId: 'bot-1',
        content: 'phần đã có',
      });
      expect(mockAgentStream.emitStep).toHaveBeenCalledWith(
        {
          userId: 'user-1',
          channelId: 'channel-1',
          messageId: 'clarification-msg-1',
          channelType: 'direct',
        },
        { type: 'done' },
      );
    });
  });
});
