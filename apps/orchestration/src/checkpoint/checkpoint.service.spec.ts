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
  const mockRepo = {
    create: jest.fn(),
    save: jest.fn(),
    findOne: jest.fn(),
    find: jest.fn(),
    update: jest.fn(),
  };

  const input = {
    replyMessageId: 'msg-1',
    userId: 'user-1',
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

  it('creates an entity instance from the input, stamping expiresAt from CHECKPOINT_EXPIRY_MS, then saves it', async () => {
    const entity = { ...input, id: 'checkpoint-1' };
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
      ORCHESTRATION_CONSTANTS.CHECKPOINT_EXPIRY_MS,
    );
    expect(mockRepo.save).toHaveBeenCalledWith(entity);
    expect(result).toBe(entity);
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
  });
});
