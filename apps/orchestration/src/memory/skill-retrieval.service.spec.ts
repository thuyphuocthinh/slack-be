import { Test, TestingModule } from '@nestjs/testing';
import { ECheckpointRiskLevel } from '@slack/constants';
import { SkillRetrievalService } from './skill-retrieval.service';
import { SkillService } from './skill.service';
import { OpenAiEmbeddingProvider } from '../registry/openai-embedding.provider';
import { SkillEntity } from '../entity/skill.entity';

describe('SkillRetrievalService', () => {
  let service: SkillRetrievalService;

  const mockSkillService = { findByWorkspace: jest.fn() };
  const mockEmbeddingProvider = { embed: jest.fn() };

  const buildSkill = (overrides: Partial<SkillEntity> = {}): SkillEntity =>
    ({
      id: 'skill-1',
      workspaceId: 'ws-1',
      taskDescription: 'tạo 5 sản phẩm ngẫu nhiên',
      summaryMarkdown: '## Skill',
      steps: [],
      sourceCheckpointIds: [],
      approvedRunCount: 2,
      riskLevel: ECheckpointRiskLevel.MEDIUM,
      createdAt: new Date(),
      ...overrides,
    }) as SkillEntity;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SkillRetrievalService,
        { provide: SkillService, useValue: mockSkillService },
        { provide: OpenAiEmbeddingProvider, useValue: mockEmbeddingProvider },
      ],
    }).compile();

    service = module.get<SkillRetrievalService>(SkillRetrievalService);
  });

  afterEach(() => jest.clearAllMocks());

  it('returns null when the workspace has no skills yet', async () => {
    mockSkillService.findByWorkspace.mockResolvedValue([]);

    const result = await service.findMatching('tạo 5 sản phẩm', 'ws-1');

    expect(result).toBeNull();
    expect(mockEmbeddingProvider.embed).not.toHaveBeenCalled();
  });

  it('excludes MEDIUM-risk skills with fewer than 2 approved runs', async () => {
    mockSkillService.findByWorkspace.mockResolvedValue([
      buildSkill({ approvedRunCount: 1 }),
    ]);

    const result = await service.findMatching('tạo 5 sản phẩm', 'ws-1');

    expect(result).toBeNull();
    expect(mockEmbeddingProvider.embed).not.toHaveBeenCalled();
  });

  it('excludes HIGH-risk skills with fewer than 4 approved runs, even if MEDIUM would qualify', async () => {
    mockSkillService.findByWorkspace.mockResolvedValue([
      buildSkill({
        approvedRunCount: 3,
        riskLevel: ECheckpointRiskLevel.HIGH,
      }),
    ]);

    const result = await service.findMatching('tạo 5 sản phẩm', 'ws-1');

    expect(result).toBeNull();
  });

  it('returns the skill when similarity meets the threshold', async () => {
    const skill = buildSkill();
    mockSkillService.findByWorkspace.mockResolvedValue([skill]);
    // Vector giống hệt nhau -> cosine similarity = 1, vượt ngưỡng 0.85.
    mockEmbeddingProvider.embed.mockResolvedValue([
      [1, 0, 0],
      [1, 0, 0],
    ]);

    const result = await service.findMatching('tạo 5 sản phẩm', 'ws-1');

    expect(result).toBe(skill);
  });

  it('returns null when similarity is below the threshold, even though the skill is eligible by run count', async () => {
    mockSkillService.findByWorkspace.mockResolvedValue([buildSkill()]);
    // Vector trực giao -> cosine similarity = 0, dưới ngưỡng 0.85.
    mockEmbeddingProvider.embed.mockResolvedValue([
      [1, 0],
      [0, 1],
    ]);

    const result = await service.findMatching('việc hoàn toàn khác', 'ws-1');

    expect(result).toBeNull();
  });

  it('picks the highest-similarity skill when multiple qualify above the threshold', async () => {
    const skillA = buildSkill({ id: 'skill-a' });
    const skillB = buildSkill({ id: 'skill-b' });
    mockSkillService.findByWorkspace.mockResolvedValue([skillA, skillB]);
    mockEmbeddingProvider.embed.mockResolvedValue([
      [1, 0], // query
      [0.9, Math.sqrt(1 - 0.9 * 0.9)], // skillA — similarity 0.9
      [1, 0], // skillB — similarity 1
    ]);

    const result = await service.findMatching('tạo 5 sản phẩm', 'ws-1');

    expect(result).toBe(skillB);
  });

  it('falls back to null instead of throwing when the embedding call fails', async () => {
    mockSkillService.findByWorkspace.mockResolvedValue([buildSkill()]);
    mockEmbeddingProvider.embed.mockRejectedValue(new Error('no API key'));

    const result = await service.findMatching('tạo 5 sản phẩm', 'ws-1');

    expect(result).toBeNull();
  });

  describe('findSimilarForAcquisition', () => {
    it('matches a skill even when it has NOT yet crossed the trust threshold (unlike findMatching)', async () => {
      const skill = buildSkill({ approvedRunCount: 1 });
      mockSkillService.findByWorkspace.mockResolvedValue([skill]);
      mockEmbeddingProvider.embed.mockResolvedValue([
        [1, 0],
        [1, 0],
      ]);

      const result = await service.findSimilarForAcquisition(
        'tạo 5 sản phẩm',
        'ws-1',
      );

      expect(result).toBe(skill);
    });

    it('returns null when no skill is similar enough, so the caller knows to create a new one', async () => {
      mockSkillService.findByWorkspace.mockResolvedValue([
        buildSkill({ approvedRunCount: 1 }),
      ]);
      mockEmbeddingProvider.embed.mockResolvedValue([
        [1, 0],
        [0, 1],
      ]);

      const result = await service.findSimilarForAcquisition(
        'việc hoàn toàn khác',
        'ws-1',
      );

      expect(result).toBeNull();
    });
  });
});
