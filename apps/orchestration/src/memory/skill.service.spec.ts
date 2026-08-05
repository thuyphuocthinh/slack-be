import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ECheckpointRiskLevel } from '@slack/constants';
import { SkillService } from './skill.service';
import { SkillEntity } from '../entity/skill.entity';

describe('SkillService', () => {
  let service: SkillService;

  const mockRepo = {
    find: jest.fn(),
    create: jest.fn((input) => input),
    save: jest.fn(),
    findOne: jest.fn(),
    update: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SkillService,
        { provide: getRepositoryToken(SkillEntity), useValue: mockRepo },
      ],
    }).compile();

    service = module.get<SkillService>(SkillService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('findByWorkspace', () => {
    it('queries skills scoped to the given workspaceId', async () => {
      mockRepo.find.mockResolvedValue([{ id: 'skill-1' }]);

      const result = await service.findByWorkspace('ws-1');

      expect(mockRepo.find).toHaveBeenCalledWith({
        where: { workspaceId: 'ws-1' },
      });
      expect(result).toEqual([{ id: 'skill-1' }]);
    });
  });

  describe('create', () => {
    it('seeds sourceCheckpointIds with exactly the one checkpoint that produced this skill', async () => {
      mockRepo.save.mockResolvedValue({ id: 'skill-1' });

      await service.create({
        workspaceId: 'ws-1',
        taskDescription: 'tạo 5 sản phẩm ngẫu nhiên',
        summaryMarkdown: '## Tạo sản phẩm\nGọi execute_write_query để INSERT.',
        steps: [
          {
            provider: 'sql_server',
            tool: 'execute_write_query',
            argsTemplate: { query: 'INSERT INTO Products ...' },
          },
        ],
        sourceCheckpointId: 'checkpoint-1',
        riskLevel: ECheckpointRiskLevel.MEDIUM,
      });

      expect(mockRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ sourceCheckpointIds: ['checkpoint-1'] }),
      );
    });
  });

  describe('incrementApprovedRunCount', () => {
    it('bumps the count and appends the new checkpoint id, keeps steps unchanged', async () => {
      mockRepo.findOne.mockResolvedValue({
        id: 'skill-1',
        approvedRunCount: 2,
        sourceCheckpointIds: ['checkpoint-1'],
      });

      await service.incrementApprovedRunCount('skill-1', 'checkpoint-2');

      expect(mockRepo.update).toHaveBeenCalledWith('skill-1', {
        approvedRunCount: 3,
        sourceCheckpointIds: ['checkpoint-1', 'checkpoint-2'],
      });
    });

    it('does nothing when the skill no longer exists (deleted between match and record)', async () => {
      mockRepo.findOne.mockResolvedValue(null);

      await service.incrementApprovedRunCount('skill-1', 'checkpoint-2');

      expect(mockRepo.update).not.toHaveBeenCalled();
    });
  });
});
