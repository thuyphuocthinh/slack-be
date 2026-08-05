import { Test, TestingModule } from '@nestjs/testing';
import { MemoryManagerService } from './memory-manager.service';
import { ChannelMemoryService } from './channel-memory.service';
import {
  resolveDataCharBudget,
  resolveHistoryCharBudget,
  resolveMemoryCharBudget,
} from '../executor/tool-result-size-cap.util';

describe('MemoryManagerService', () => {
  let service: MemoryManagerService;
  const mockChannelMemory = { getRecentMemories: jest.fn() };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MemoryManagerService,
        { provide: ChannelMemoryService, useValue: mockChannelMemory },
      ],
    }).compile();

    service = module.get(MemoryManagerService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('buildBudget', () => {
    it('returns the 3 budgets computed from the same model id', () => {
      const budget = service.buildBudget('gpt-4o-mini');

      expect(budget).toEqual({
        toolResultCharBudget: resolveDataCharBudget('gpt-4o-mini'),
        memoryCharBudget: resolveMemoryCharBudget('gpt-4o-mini'),
        historyCharBudget: resolveHistoryCharBudget('gpt-4o-mini'),
      });
    });

    it('never lets memoryCharBudget or historyCharBudget exceed toolResultCharBudget', () => {
      const budget = service.buildBudget('gpt-4o-mini');

      expect(budget.memoryCharBudget).toBeLessThan(budget.toolResultCharBudget);
      expect(budget.historyCharBudget).toBeLessThan(
        budget.toolResultCharBudget,
      );
    });
  });

  describe('getMemories', () => {
    it('resolves the char budget from modelId and forwards it to ChannelMemoryService', async () => {
      mockChannelMemory.getRecentMemories.mockResolvedValue([]);

      await service.getMemories('chan-1', 'gpt-4o-mini', 'câu hỏi hiện tại');

      expect(mockChannelMemory.getRecentMemories).toHaveBeenCalledWith(
        'chan-1',
        resolveMemoryCharBudget('gpt-4o-mini'),
        'câu hỏi hiện tại',
      );
    });

    it('works without a queryText (forwards undefined)', async () => {
      mockChannelMemory.getRecentMemories.mockResolvedValue([]);

      await service.getMemories('chan-1', 'gpt-4o-mini');

      expect(mockChannelMemory.getRecentMemories).toHaveBeenCalledWith(
        'chan-1',
        resolveMemoryCharBudget('gpt-4o-mini'),
        undefined,
      );
    });

    it('returns whatever ChannelMemoryService resolves', async () => {
      const rows = [{ id: '1' }];
      mockChannelMemory.getRecentMemories.mockResolvedValue(rows);

      const result = await service.getMemories('chan-1', 'gpt-4o-mini');

      expect(result).toBe(rows);
    });
  });
});
