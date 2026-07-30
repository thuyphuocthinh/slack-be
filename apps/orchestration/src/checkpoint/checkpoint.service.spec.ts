import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ORCHESTRATION_CONSTANTS } from '@slack/constants';
import { CheckpointService } from './checkpoint.service';
import {
  OrchestrationCheckpointEntity,
  OrchestrationCheckpointStatus,
} from '../entity/orchestration-checkpoint.entity';

describe('CheckpointService', () => {
  let service: CheckpointService;
  const mockQueryBuilder = {
    update: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    execute: jest.fn(),
  };
  const mockRepo = {
    create: jest.fn(),
    save: jest.fn(),
    findOne: jest.fn(),
    find: jest.fn(),
    update: jest.fn(),
    createQueryBuilder: jest.fn(() => mockQueryBuilder),
  };

  const input = {
    replyMessageId: 'msg-1',
    userId: 'user-1',
    botUserId: 'bot-1',
    channelId: 'channel-1',
    workspaceId: 'workspace-1',
    channelType: 'direct',
    originalPrompt: 'cập nhật đơn OrderId=1 thành Completed',
    pendingTool: {
      provider: 'sql_server',
      name: 'execute_write_query',
      args: { query: 'UPDATE Orders SET Status=1' },
    },
    pendingTask: 'cập nhật status đơn OrderId=1',
    roundsSoFar: [],
    history: [],
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CheckpointService,
        {
          provide: getRepositoryToken(OrchestrationCheckpointEntity),
          useValue: mockRepo,
        },
      ],
    }).compile();

    service = module.get<CheckpointService>(CheckpointService);
  });

  it('creates an entity instance from the input, stamping expiresAt from CHECKPOINT_EXPIRY_MS, then saves it, returning a CheckpointResponseDto (not the raw ORM entity)', async () => {
    const entity = {
      ...input,
      id: 'checkpoint-1',
      status: OrchestrationCheckpointStatus.PENDING,
      expiresAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    mockRepo.create.mockReturnValue(entity);
    mockRepo.save.mockResolvedValue(entity);
    const before = Date.now();

    const result = await service.create(input);

    expect(mockRepo.create).toHaveBeenCalledTimes(1);
    const createArg = mockRepo.create.mock.calls[0][0];
    expect(createArg).toMatchObject(input);
    expect(createArg.expiresAt).toBeInstanceOf(Date);
    const offsetMs = createArg.expiresAt.getTime() - before;
    expect(offsetMs).toBeGreaterThan(
      ORCHESTRATION_CONSTANTS.CHECKPOINT_EXPIRY_MS - 1000,
    );
    expect(offsetMs).toBeLessThanOrEqual(
      ORCHESTRATION_CONSTANTS.CHECKPOINT_EXPIRY_MS + 1000,
    );
    expect(mockRepo.save).toHaveBeenCalledWith(entity);
    // toEqual (không phải toBe) — create() giờ map qua toResponseDto(), trả
    // 1 object MỚI chứ không phải nguyên văn entity từ repo.save().
    expect(result).toEqual(entity);
  });

  describe('findPendingByReplyMessageId', () => {
    it('only looks up checkpoints still pending — approved/rejected ones should not resolve again', async () => {
      mockRepo.findOne.mockResolvedValue({ id: 'checkpoint-1' });

      await service.findPendingByReplyMessageId({ replyMessageId: 'msg-1' });

      expect(mockRepo.findOne).toHaveBeenCalledWith({
        where: {
          replyMessageId: 'msg-1',
          status: OrchestrationCheckpointStatus.PENDING,
        },
      });
    });

    it('returns null when nothing pending matches', async () => {
      mockRepo.findOne.mockResolvedValue(null);

      const result = await service.findPendingByReplyMessageId({
        replyMessageId: 'msg-unknown',
      });

      expect(result).toBeNull();
    });

    it('maps the ORM entity to a CheckpointResponseDto — internal-only fields never declared on the DTO do not leak through', async () => {
      mockRepo.findOne.mockResolvedValue({
        id: 'checkpoint-1',
        replyMessageId: 'msg-1',
        userId: 'user-1',
        botUserId: 'bot-1',
        channelId: 'channel-1',
        workspaceId: 'workspace-1',
        channelType: 'direct',
        originalPrompt: 'câu hỏi gốc',
        pendingTool: {
          provider: 'sql_server',
          name: 'execute_write_query',
          args: {},
        },
        pendingTask: 'task',
        roundsSoFar: [],
        history: [],
        status: OrchestrationCheckpointStatus.PENDING,
        expiresAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
        someFutureOrmOnlyField: 'should not leak',
      });

      const result = await service.findPendingByReplyMessageId({
        replyMessageId: 'msg-1',
      });

      expect(result).not.toHaveProperty('someFutureOrmOnlyField');
    });
  });

  describe('findExpiredPending', () => {
    it('queries pending checkpoints whose expiresAt has passed', async () => {
      mockRepo.find.mockResolvedValue([{ id: 'checkpoint-1' }]);

      const result = await service.findExpiredPending();

      expect(mockRepo.find).toHaveBeenCalledWith({
        where: {
          status: OrchestrationCheckpointStatus.PENDING,
          expiresAt: expect.anything(),
        },
      });
      expect(result).toEqual([{ id: 'checkpoint-1' }]);
    });
  });

  describe('findById', () => {
    it('looks up a checkpoint regardless of status (used to re-fetch AFTER claim() already changed it)', async () => {
      mockRepo.findOne.mockResolvedValue({
        id: 'checkpoint-1',
        status: OrchestrationCheckpointStatus.APPROVED,
      });

      const result = await service.findById({ id: 'checkpoint-1' });

      expect(mockRepo.findOne).toHaveBeenCalledWith({
        where: { id: 'checkpoint-1' },
      });
      expect(result).toEqual({
        id: 'checkpoint-1',
        status: OrchestrationCheckpointStatus.APPROVED,
      });
    });

    it('returns null when the id does not exist', async () => {
      mockRepo.findOne.mockResolvedValue(null);

      const result = await service.findById({ id: 'unknown' });

      expect(result).toBeNull();
    });
  });

  describe('claim', () => {
    it('atomically transitions status only WHERE it is still pending, and reports claimed=true on success', async () => {
      mockRepo.update.mockResolvedValue({ affected: 1 });

      const result = await service.claim({
        id: 'checkpoint-1',
        toStatus: OrchestrationCheckpointStatus.APPROVED,
      });

      expect(mockRepo.update).toHaveBeenCalledWith(
        { id: 'checkpoint-1', status: OrchestrationCheckpointStatus.PENDING },
        { status: OrchestrationCheckpointStatus.APPROVED },
      );
      expect(result).toEqual({ claimed: true });
    });

    it('reports claimed=false when nothing was pending anymore (lost the race to another request)', async () => {
      mockRepo.update.mockResolvedValue({ affected: 0 });

      const result = await service.claim({
        id: 'checkpoint-1',
        toStatus: OrchestrationCheckpointStatus.REJECTED,
      });

      expect(result).toEqual({ claimed: false });
    });

    it('accuracy_problem.md mục 1 — includes selectedProvider in the SAME atomic update when resolving a clarification checkpoint', async () => {
      mockRepo.update.mockResolvedValue({ affected: 1 });

      await service.claim({
        id: 'checkpoint-2',
        toStatus: OrchestrationCheckpointStatus.APPROVED,
        selectedProvider: 'notion',
      });

      expect(mockRepo.update).toHaveBeenCalledWith(
        { id: 'checkpoint-2', status: OrchestrationCheckpointStatus.PENDING },
        {
          status: OrchestrationCheckpointStatus.APPROVED,
          selectedProvider: 'notion',
        },
      );
    });

    it('does not touch selectedProvider at all when resolving a normal approval checkpoint', async () => {
      mockRepo.update.mockResolvedValue({ affected: 1 });

      await service.claim({
        id: 'checkpoint-1',
        toStatus: OrchestrationCheckpointStatus.APPROVED,
      });

      expect(mockRepo.update).toHaveBeenCalledWith(
        { id: 'checkpoint-1', status: OrchestrationCheckpointStatus.PENDING },
        { status: OrchestrationCheckpointStatus.APPROVED },
      );
    });
  });

  describe('claimExecution (Giai đoạn 4, Step 1 — idempotency cho processApprovalJob)', () => {
    it('atomically sets execution_started_at only WHERE it is still NULL, and reports claimed=true on success', async () => {
      mockQueryBuilder.execute.mockResolvedValue({ affected: 1 });

      const result = await service.claimExecution({ id: 'checkpoint-1' });

      expect(mockRepo.createQueryBuilder).toHaveBeenCalled();
      expect(mockQueryBuilder.where).toHaveBeenCalledWith('id = :id', {
        id: 'checkpoint-1',
      });
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'execution_started_at IS NULL',
      );
      expect(result).toEqual({ claimed: true });
    });

    it('reports claimed=false when the checkpoint was already executed (job retried/redelivered)', async () => {
      mockQueryBuilder.execute.mockResolvedValue({ affected: 0 });

      const result = await service.claimExecution({ id: 'checkpoint-1' });

      expect(result).toEqual({ claimed: false });
    });
  });

  describe('markToolExecuted (bug fix — phân biệt worker crash trước/sau khi tool chạy)', () => {
    it('sets tool_executed_at for the given checkpoint id', async () => {
      mockQueryBuilder.execute.mockResolvedValue({ affected: 1 });

      await service.markToolExecuted({ id: 'checkpoint-1' });

      expect(mockRepo.createQueryBuilder).toHaveBeenCalled();
      expect(mockQueryBuilder.where).toHaveBeenCalledWith('id = :id', {
        id: 'checkpoint-1',
      });
    });
  });

  describe('findStalledExecution (Bug fix — checkpoint kẹt sau worker crash)', () => {
    it('queries APPROVED checkpoints whose execution_started_at is older than STALLED_EXECUTION_TTL_MS', async () => {
      mockRepo.find.mockResolvedValue([{ id: 'stalled-1' }]);

      const result = await service.findStalledExecution();

      expect(mockRepo.find).toHaveBeenCalledWith({
        where: {
          status: OrchestrationCheckpointStatus.APPROVED,
          executionStartedAt: expect.anything(), // TypeORM And(Not(IsNull()), LessThan(...))
        },
      });
      expect(result).toEqual([{ id: 'stalled-1' }]);
    });

    it('returns an empty array when no stalled checkpoints exist', async () => {
      mockRepo.find.mockResolvedValue([]);

      const result = await service.findStalledExecution();

      expect(result).toEqual([]);
    });

    it('does NOT query PENDING checkpoints — those are handled by findExpiredPending()', async () => {
      mockRepo.find.mockResolvedValue([]);

      await service.findStalledExecution();

      const whereArg = mockRepo.find.mock.calls[0][0].where;
      expect(whereArg.status).toBe(OrchestrationCheckpointStatus.APPROVED);
      expect(whereArg.status).not.toBe(OrchestrationCheckpointStatus.PENDING);
    });
  });

  describe('markStalledAsRejected (Bug fix — atomic cleanup voor stalled APPROVED checkpoints)', () => {
    it('atomically transitions status from APPROVED to REJECTED and reports claimed=true on success', async () => {
      mockRepo.update.mockResolvedValue({ affected: 1 });

      const result = await service.markStalledAsRejected({ id: 'stalled-1' });

      expect(mockRepo.update).toHaveBeenCalledWith(
        { id: 'stalled-1', status: OrchestrationCheckpointStatus.APPROVED },
        { status: OrchestrationCheckpointStatus.REJECTED },
      );
      expect(result).toEqual({ claimed: true });
    });

    it('reports claimed=false when the checkpoint is no longer APPROVED (already resolved or recovered by another cron run)', async () => {
      mockRepo.update.mockResolvedValue({ affected: 0 });

      const result = await service.markStalledAsRejected({ id: 'stalled-1' });

      expect(result).toEqual({ claimed: false });
    });

    it('does NOT touch PENDING checkpoints — WHERE clause enforces status=APPROVED only', async () => {
      mockRepo.update.mockResolvedValue({ affected: 0 });

      await service.markStalledAsRejected({ id: 'checkpoint-1' });

      const whereArg = mockRepo.update.mock.calls[0][0];
      expect(whereArg.status).toBe(OrchestrationCheckpointStatus.APPROVED);
    });
  });
});
