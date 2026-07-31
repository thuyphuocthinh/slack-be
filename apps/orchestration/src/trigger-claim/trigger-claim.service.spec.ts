import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { TriggerClaimService } from './trigger-claim.service';
import { OrchestrationTriggerClaimEntity } from '../entity/orchestration-trigger-claim.entity';

describe('TriggerClaimService (Giai đoạn 4, Step 1 — idempotency cho PROCESS_AI_TRIGGER)', () => {
  let service: TriggerClaimService;
  const mockQueryBuilder = {
    insert: jest.fn().mockReturnThis(),
    into: jest.fn().mockReturnThis(),
    values: jest.fn().mockReturnThis(),
    orIgnore: jest.fn().mockReturnThis(),
    execute: jest.fn(),
  };
  const mockRepo = {
    createQueryBuilder: jest.fn(() => mockQueryBuilder),
    delete: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockQueryBuilder.insert.mockReturnThis();
    mockQueryBuilder.into.mockReturnThis();
    mockQueryBuilder.values.mockReturnThis();
    mockQueryBuilder.orIgnore.mockReturnThis();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TriggerClaimService,
        {
          provide: getRepositoryToken(OrchestrationTriggerClaimEntity),
          useValue: mockRepo,
        },
      ],
    }).compile();

    service = module.get<TriggerClaimService>(TriggerClaimService);
  });

  it('inserts with ON CONFLICT DO NOTHING and reports claimed=true when a new row was inserted', async () => {
    mockQueryBuilder.execute.mockResolvedValue({ identifiers: [{ id: 'x' }] });

    const result = await service.claim('trigger-msg-1');

    expect(mockQueryBuilder.values).toHaveBeenCalledWith({
      triggerMessageId: 'trigger-msg-1',
    });
    expect(mockQueryBuilder.orIgnore).toHaveBeenCalled();
    expect(result).toBe(true);
  });

  it('reports claimed=false when the row already existed (conflict, no insert happened)', async () => {
    mockQueryBuilder.execute.mockResolvedValue({ identifiers: [] });

    const result = await service.claim('trigger-msg-1');

    expect(result).toBe(false);
  });

  describe('release (hardening: undo a claim when nothing real was created yet, so a retry is safe)', () => {
    it('deletes the claim row for the given triggerMessageId', async () => {
      mockRepo.delete.mockResolvedValue({ affected: 1 });

      await service.release('trigger-msg-1');

      expect(mockRepo.delete).toHaveBeenCalledWith({
        triggerMessageId: 'trigger-msg-1',
      });
    });
  });

  describe('reapStaleClaims (TTL reaper: unblocks a claim orphaned by a hard worker crash)', () => {
    it('deletes claims older than the TTL', async () => {
      mockRepo.delete.mockResolvedValue({ affected: 2 });

      await service.reapStaleClaims();

      expect(mockRepo.delete).toHaveBeenCalledWith({
        createdAt: expect.anything(),
      });
    });

    it('does not warn when nothing was stale', async () => {
      mockRepo.delete.mockResolvedValue({ affected: 0 });

      await service.reapStaleClaims();
    });
  });
});
