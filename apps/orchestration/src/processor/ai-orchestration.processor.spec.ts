import { Test, TestingModule } from '@nestjs/testing';
import { Job } from 'bullmq';
import { EJobName, IProcessAiTriggerJobData, IProcessApprovalJobData } from '@slack/queue';
import { AiOrchestrationProcessor } from './ai-orchestration.processor';
import { MessageClientService } from '../message-client.service';
import { AgentStreamService } from '../socket/agent-stream.service';
import { TriggerClaimService } from '../trigger-claim/trigger-claim.service';
import { AgentCancellationService } from '../cancellation/agent-cancellation.service';
import { TurnCancelledError } from '../llm/turn-cancelled.error';
import { TurnResolverService } from './turn-resolver.service';
import { ApprovalFlowService } from './approval-flow.service';

// ai-orchestration.processor.ts import ReactLoopService (dù đã mock qua DI ở
// dưới) — file thật của nó vẫn import @slack/common ở module scope, kéo theo
// "nanoid" (ESM-only) mà jest không transform được. Mock thẳng barrel, cùng
// convention đã dùng ở auth.service.spec.ts.
jest.mock('@slack/common', () => ({ extractTextFromMcpResult: jest.fn() }));

// Fix Jest ESM import issue with uuid package
jest.mock('uuid', () => ({ v4: jest.fn(() => 'test-uuid') }));

describe('AiOrchestrationProcessor', () => {
  let processor: AiOrchestrationProcessor;

  const mockMessageClient = {
    createMessage: jest.fn(),
    updateMessage: jest.fn(),
  };
  const mockAgentStream = { emitStep: jest.fn() };
  const mockTriggerClaim = { claim: jest.fn() };
  // Mặc định: turn chưa từng bị yêu cầu Stop — test nào cần mô phỏng Stop tự
  // override isCancelled/getOwner riêng.
  const mockCancellation = {
    startTurn: jest.fn(),
    getOwner: jest.fn(),
    requestCancel: jest.fn(),
    isCancelled: jest.fn().mockResolvedValue(false),
  };
  const mockTurnResolver = { resolveAnswer: jest.fn() };
  const mockApprovalFlow = { processApprovalJob: jest.fn() };

  const jobData: IProcessAiTriggerJobData = {
    userId: 'user-1',
    channelId: 'channel-1',
    workspaceId: 'workspace-1',
    messageId: 'trigger-msg-1',
    botUserId: 'bot-1',
    channelType: 'direct',
  };

  beforeEach(async () => {
    mockMessageClient.createMessage.mockResolvedValue({ id: 'reply-1' });
    mockMessageClient.updateMessage.mockResolvedValue(undefined);
    mockAgentStream.emitStep.mockResolvedValue(undefined);
    mockTriggerClaim.claim.mockResolvedValue(true);
    mockCancellation.isCancelled.mockResolvedValue(false);
    mockApprovalFlow.processApprovalJob.mockResolvedValue(undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AiOrchestrationProcessor,
        { provide: MessageClientService, useValue: mockMessageClient },
        { provide: AgentStreamService, useValue: mockAgentStream },
        { provide: TriggerClaimService, useValue: mockTriggerClaim },
        { provide: AgentCancellationService, useValue: mockCancellation },
        { provide: TurnResolverService, useValue: mockTurnResolver },
        { provide: ApprovalFlowService, useValue: mockApprovalFlow },
      ],
    }).compile();

    processor = module.get<AiOrchestrationProcessor>(AiOrchestrationProcessor);
  });

  afterEach(() => jest.clearAllMocks());

  const runJob = (data: IProcessAiTriggerJobData = jobData) =>
    processor.process({ name: EJobName.PROCESS_AI_TRIGGER, data } as Job<
      IProcessAiTriggerJobData,
      void,
      EJobName
    >);

  it('creates a placeholder message before doing anything else', async () => {
    mockTurnResolver.resolveAnswer.mockResolvedValue({ content: 'Chào bạn!' });

    await runJob();

    expect(mockMessageClient.createMessage).toHaveBeenCalledWith({
      channelId: jobData.channelId,
      senderId: jobData.botUserId,
      content: '🤖 Đang xử lý...',
    });
  });

  it('records the turn owner and traces resolveAnswer(), then saves whatever TurnResolverService returns', async () => {
    mockTurnResolver.resolveAnswer.mockResolvedValue({
      content: 'Có 2 bảng.',
      toolCalls: [{ tool: 'get_database_schema', status: 'success' }],
    });

    await runJob();

    expect(mockCancellation.startTurn).toHaveBeenCalledWith(
      'reply-1',
      jobData.userId,
    );
    expect(mockTurnResolver.resolveAnswer).toHaveBeenCalledWith(
      jobData,
      'reply-1',
    );
    expect(mockMessageClient.updateMessage).toHaveBeenCalledWith({
      id: 'reply-1',
      userId: jobData.botUserId,
      content: 'Có 2 bảng.',
      toolCalls: [{ tool: 'get_database_schema', status: 'success' }],
    });
    // "done" phải bắn luôn, dù trả lời thành công — FE dựa vào đây để tắt icon "đang chạy tool...".
    expect(mockAgentStream.emitStep).toHaveBeenCalledWith(
      {
        userId: jobData.userId,
        channelId: jobData.channelId,
        messageId: 'reply-1',
        channelType: jobData.channelType,
      },
      { type: 'done' },
    );
  });

  it('updates the reply with the raw error message when TurnResolverService throws', async () => {
    mockTurnResolver.resolveAnswer.mockRejectedValue(
      new Error('LLM provider is down'),
    );

    await runJob();

    expect(mockMessageClient.updateMessage).toHaveBeenCalledWith({
      id: 'reply-1',
      userId: jobData.botUserId,
      content: '⚠️ Lỗi: LLM provider is down',
    });
    // "done" vẫn phải bắn kể cả khi lỗi — không thì FE treo mãi icon "đang chạy".
    expect(mockAgentStream.emitStep).toHaveBeenCalledWith(expect.anything(), {
      type: 'done',
    });
  });

  it('Giai đoạn 4, Step 1 — claims triggerMessageId BEFORE creating the placeholder message', async () => {
    mockTurnResolver.resolveAnswer.mockResolvedValue({ content: 'Chào bạn!' });

    await runJob();

    expect(mockTriggerClaim.claim).toHaveBeenCalledWith(jobData.messageId);
  });

  it('Giai đoạn 4, Step 1 — skips creating a duplicate placeholder when the trigger was already claimed (job retried/redelivered)', async () => {
    mockTriggerClaim.claim.mockResolvedValue(false);

    await runJob();

    expect(mockMessageClient.createMessage).not.toHaveBeenCalled();
    expect(mockTurnResolver.resolveAnswer).not.toHaveBeenCalled();
  });

  it('throws for an unsupported job name', async () => {
    await expect(
      processor.process({
        name: 'unknown_job',
        data: jobData,
      } as unknown as Job<IProcessAiTriggerJobData, void, EJobName>),
    ).rejects.toThrow('Job name unknown_job is not supported');
  });

  it('dispatches PROCESS_APPROVAL jobs to ApprovalFlowService.processApprovalJob()', async () => {
    const approvalJobData: IProcessApprovalJobData = {
      checkpointId: 'checkpoint-1',
      userId: 'user-1',
    };

    await processor.process({
      name: EJobName.PROCESS_APPROVAL,
      data: approvalJobData,
    } as Job<IProcessApprovalJobData, void, EJobName>);

    expect(mockApprovalFlow.processApprovalJob).toHaveBeenCalledWith(
      approvalJobData,
    );
  });

  describe('cancelTurn (Stop request)', () => {
    it('throws TURN_NOT_FOUND when no turn is running for this messageId (finished long ago / never started)', async () => {
      mockCancellation.getOwner.mockResolvedValue(null);

      await expect(
        processor.cancelTurn({ userId: 'user-1', messageId: 'reply-1' }),
      ).rejects.toThrow();
      expect(mockCancellation.requestCancel).not.toHaveBeenCalled();
    });

    it('throws TURN_FORBIDDEN when the requester is not the user who triggered the turn', async () => {
      mockCancellation.getOwner.mockResolvedValue('user-1');

      await expect(
        processor.cancelTurn({ userId: 'some-other-user', messageId: 'reply-1' }),
      ).rejects.toThrow();
      expect(mockCancellation.requestCancel).not.toHaveBeenCalled();
    });

    it('requests cancellation when the requester owns the turn', async () => {
      mockCancellation.getOwner.mockResolvedValue('user-1');

      await processor.cancelTurn({ userId: 'user-1', messageId: 'reply-1' });

      expect(mockCancellation.requestCancel).toHaveBeenCalledWith('reply-1');
    });
  });

  describe('handleAiTrigger — Stop mid-turn (TurnCancelledError)', () => {
    it('shows "Đã dừng theo yêu cầu" instead of an error, and still emits done, when the turn is cancelled with no partial text', async () => {
      mockTurnResolver.resolveAnswer.mockRejectedValue(new TurnCancelledError());

      await runJob();

      expect(mockMessageClient.updateMessage).toHaveBeenCalledWith({
        id: 'reply-1',
        userId: jobData.botUserId,
        content: '⏹️ Đã dừng theo yêu cầu.',
      });
      expect(mockAgentStream.emitStep).toHaveBeenCalledWith(
        {
          userId: jobData.userId,
          channelId: jobData.channelId,
          messageId: 'reply-1',
          channelType: jobData.channelType,
        },
        { type: 'done' },
      );
    });

    it('keeps the partial text already streamed instead of wiping it, when the turn is cancelled mid-stream', async () => {
      mockTurnResolver.resolveAnswer.mockRejectedValue(
        new TurnCancelledError('Đang tìm dữ liệu kh'),
      );

      await runJob();

      expect(mockMessageClient.updateMessage).toHaveBeenCalledWith({
        id: 'reply-1',
        userId: jobData.botUserId,
        content: 'Đang tìm dữ liệu kh',
      });
    });
  });
});
