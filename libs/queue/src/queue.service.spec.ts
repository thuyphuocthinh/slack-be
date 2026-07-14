import { Test, TestingModule } from '@nestjs/testing';
import { ModuleRef } from '@nestjs/core';
import { getQueueToken } from '@nestjs/bullmq';
import { QueueService } from './queue.service';
import { EQueueName, EJobName } from './constants/queue.constant';

describe('QueueService', () => {
  let service: QueueService;
  const mockQueue = {
    add: jest.fn(),
    addBulk: jest.fn(),
    getJob: jest.fn(),
    getJobCounts: jest.fn(),
  };
  const mockModuleRef = { get: jest.fn() };

  beforeEach(async () => {
    mockModuleRef.get.mockReturnValue(mockQueue);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QueueService,
        { provide: ModuleRef, useValue: mockModuleRef },
      ],
    }).compile();

    service = module.get<QueueService>(QueueService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('getJobCounts', () => {
    it('only asks BullMQ for "waiting" and "active" counts (not completed/failed/delayed)', async () => {
      mockQueue.getJobCounts.mockResolvedValue({ waiting: 3, active: 2 });

      const result = await service.getJobCounts(
        EQueueName.AI_ORCHESTRATION_QUEUE,
      );

      expect(mockModuleRef.get).toHaveBeenCalledWith(
        getQueueToken(EQueueName.AI_ORCHESTRATION_QUEUE),
        { strict: false },
      );
      expect(mockQueue.getJobCounts).toHaveBeenCalledWith('waiting', 'active');
      expect(result).toEqual({ waiting: 3, active: 2 });
    });

    it('throws when the queue is not registered', async () => {
      mockModuleRef.get.mockReturnValue(undefined);

      await expect(
        service.getJobCounts(EQueueName.AI_ORCHESTRATION_QUEUE),
      ).rejects.toThrow('not found or not registered');
    });
  });

  describe('isOverloaded', () => {
    it('returns false when waiting+active is at or under maxDepth', async () => {
      mockQueue.getJobCounts.mockResolvedValue({ waiting: 60, active: 40 });

      const result = await service.isOverloaded(
        EQueueName.AI_ORCHESTRATION_QUEUE,
        100,
      );

      expect(result).toBe(false);
    });

    it('returns true when waiting+active exceeds maxDepth', async () => {
      mockQueue.getJobCounts.mockResolvedValue({ waiting: 80, active: 21 });

      const result = await service.isOverloaded(
        EQueueName.AI_ORCHESTRATION_QUEUE,
        100,
      );

      expect(result).toBe(true);
    });

    it('treats missing counts as 0 instead of throwing', async () => {
      mockQueue.getJobCounts.mockResolvedValue({});

      const result = await service.isOverloaded(
        EQueueName.AI_ORCHESTRATION_QUEUE,
        0,
      );

      expect(result).toBe(false);
    });
  });

  describe('addJob (existing behavior — regression guard)', () => {
    it('adds a job with default retry options merged under any explicit overrides', async () => {
      mockQueue.add.mockResolvedValue({ id: 'job-1' });

      await service.addJob(
        EQueueName.AI_ORCHESTRATION_QUEUE,
        EJobName.PROCESS_AI_TRIGGER,
        { foo: 'bar' } as never,
      );

      expect(mockQueue.add).toHaveBeenCalledWith(
        EJobName.PROCESS_AI_TRIGGER,
        { foo: 'bar' },
        expect.objectContaining({ attempts: 3 }),
      );
    });
  });
});
