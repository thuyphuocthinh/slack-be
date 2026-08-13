import { Test, TestingModule } from '@nestjs/testing';
import { ORCHESTRATION_CONSTANTS } from '@slack/constants';
import { AgentRankingService } from './agent-ranking.service';
import { OpenAiEmbeddingProvider } from '../registry/openai-embedding.provider';
import { AvailableAgentDto } from '../dto/supervisor.dto';

describe('AgentRankingService', () => {
  let service: AgentRankingService;
  const mockEmbeddingProvider = { embed: jest.fn() };

  const buildAgents = (n: number): AvailableAgentDto[] =>
    Array.from({ length: n }, (_, i) => ({
      provider: `provider_${i}`,
      label: `Provider ${i}`,
      description: `Hệ thống thứ ${i}, không liên quan gì tới nhau.`,
    }));

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AgentRankingService,
        { provide: OpenAiEmbeddingProvider, useValue: mockEmbeddingProvider },
      ],
    }).compile();

    service = module.get<AgentRankingService>(AgentRankingService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('rankAgentsForPrompt', () => {
    it('returns every agent unchanged, without calling the embedding provider, when at or below the ranking threshold', async () => {
      const agents = buildAgents(
        ORCHESTRATION_CONSTANTS.MAX_AGENTS_BEFORE_RANKING,
      );

      const result = await service.rankAgentsForPrompt('câu hỏi', agents);

      expect(result).toEqual({ shown: agents, omittedCount: 0 });
      expect(mockEmbeddingProvider.embed).not.toHaveBeenCalled();
    });

    it('ranks and hides irrelevant agents once above the threshold, keeping only what the embedding index actually returned', async () => {
      const agents = buildAgents(
        ORCHESTRATION_CONSTANTS.MAX_AGENTS_BEFORE_RANKING + 1,
      );
      mockEmbeddingProvider.embed.mockImplementation(async (texts: string[]) =>
        texts.map(() => [1, 0, 0]),
      );

      const result = await service.rankAgentsForPrompt('câu hỏi', agents);

      expect(mockEmbeddingProvider.embed).toHaveBeenCalled();
      expect(result.shown.length).toBeLessThanOrEqual(agents.length);
      expect(result.omittedCount).toBe(agents.length - result.shown.length);
    });

    it('rescues an agent explicitly named in the prompt even if the ranking dropped it', async () => {
      const agents = buildAgents(
        ORCHESTRATION_CONSTANTS.MAX_AGENTS_BEFORE_RANKING + 1,
      );
      const named = { ...agents[agents.length - 1], label: 'GitHub' };
      agents[agents.length - 1] = named;
      // Mọi vector giống hệt nhau -> SemanticToolIndex chỉ trả về topK đầu
      // tiên, "GitHub" (đứng cuối mảng) chắc chắn bị ranking loại.
      mockEmbeddingProvider.embed.mockImplementation(async (texts: string[]) =>
        texts.map(() => [1, 0, 0]),
      );

      const result = await service.rankAgentsForPrompt(
        'lấy dữ liệu từ GitHub giúp tôi',
        agents,
      );

      expect(result.shown.some((a) => a.provider === named.provider)).toBe(
        true,
      );
    });

    it('falls back to showing every agent when the embedding provider fails', async () => {
      const agents = buildAgents(
        ORCHESTRATION_CONSTANTS.MAX_AGENTS_BEFORE_RANKING + 1,
      );
      mockEmbeddingProvider.embed.mockRejectedValue(new Error('no API key'));

      const result = await service.rankAgentsForPrompt('câu hỏi', agents);

      expect(result).toEqual({ shown: agents, omittedCount: 0 });
    });
  });

  describe('findAmbiguousAgentCluster', () => {
    const NOTION: AvailableAgentDto = {
      provider: 'notion',
      label: 'Notion',
      description: 'Đọc và chỉnh sửa trang/database trên Notion.',
    };
    const GOOGLE_DOCS: AvailableAgentDto = {
      provider: 'google_docs',
      label: 'Google Docs',
      description: 'Đọc và chỉnh sửa trang/database trên Google Docs.',
    };
    const SQL_SERVER: AvailableAgentDto = {
      provider: 'sql_server',
      label: 'SQL Server',
      description: 'Truy vấn schema và dữ liệu trên SQL Server của bạn.',
    };

    it('returns null when the chosen agent no longer exists in the agent list', () => {
      const result = service.findAmbiguousAgentCluster(
        'prompt',
        [NOTION],
        'unknown_provider',
      );
      expect(result).toBeNull();
    });

    it('returns null when no other agent is similar enough (below the Jaccard threshold)', () => {
      const result = service.findAmbiguousAgentCluster(
        'lưu thông tin này lại',
        [NOTION, SQL_SERVER],
        'notion',
      );
      expect(result).toBeNull();
    });

    it('returns the cluster when 2 agents have highly overlapping descriptions and neither is uniquely named in the prompt', () => {
      const result = service.findAmbiguousAgentCluster(
        'lưu thông tin này lại',
        [NOTION, GOOGLE_DOCS],
        'notion',
      );
      expect(result).toEqual([NOTION, GOOGLE_DOCS]);
    });

    it('does NOT flag a cluster when the prompt names the chosen agent specifically but not the other', () => {
      const result = service.findAmbiguousAgentCluster(
        'lưu thông tin này vào Notion giúp tôi',
        [NOTION, GOOGLE_DOCS],
        'notion',
      );
      expect(result).toBeNull();
    });
  });
});
