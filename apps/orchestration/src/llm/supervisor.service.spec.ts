import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import {
  ORCHESTRATION_CONSTANTS,
  SUPERVISOR_PLAN_SCHEMA,
  SUPERVISOR_PLAN_SCHEMA_NO_ANSWER,
} from '@slack/constants';
import { SupervisorService } from './supervisor.service';
import { McpAuthClientService } from '../mcp-auth/mcp-auth-client.service';
import { LlmStrategyFactory } from './strategy/llm-strategy.factory';
import { CircuitBreakerService } from '../common/circuit-breaker.service';
import { DynamicProviderDbService } from '../registry/dynamic-provider-db.service';
import { OpenAiEmbeddingProvider } from '../registry/openai-embedding.provider';
import { MetricsRegistryService } from '../common/metrics-registry.service';

// Cô lập test khỏi giá trị thật của process.env.AGENT_SQL_SERVER_URL — mock
// thẳng registry để chủ động quyết định agent nào có/thiếu hạ tầng thật.
jest.mock('../registry/agents.registry', () => ({
  AGENT_REGISTRY: {
    sql_server: { label: 'SQL Server', endpoint: 'http://mcp-server/mcp' },
    // notion: đã connect qua mcp-auth (xem test bên dưới) nhưng CHƯA có agent
    // thật đăng ký (endpoint rỗng) — phải bị loại khỏi danh sách khả dụng.
    notion: { label: 'Notion', endpoint: undefined },
  },
}));

describe('SupervisorService', () => {
  let service: SupervisorService;

  const mockMcpAuthClient = { getConnectionStatus: jest.fn() };
  const mockSession = { sendMessage: jest.fn() };
  const mockStrategy = {
    id: 'gemini',
    generateStructured: jest.fn(),
    startChat: jest.fn(),
  };
  const mockLlmFactory = { resolve: jest.fn() };
  // Pass-through mặc định — giữ nguyên hành vi mọi test đã có từ trước Step 6.
  const mockCircuitBreaker = {
    run: jest.fn((_key: string, action: () => Promise<unknown>) => action()),
  };
  // Default: no dynamic (custom Swagger) providers — keeps every pre-existing static-agent test
  // unaffected. Tests that care about dynamic agents override this per-test.
  const mockDynamicProviderDb = {
    getProvidersByUser: jest.fn().mockResolvedValue([]),
  };
  // Chỉ được gọi khi agents.length > MAX_AGENTS_BEFORE_RANKING (xem describe
  // "agent-level Tool RAG" riêng bên dưới) — mọi test khác dùng agents ít nên
  // không bao giờ chạm tới mock này.
  const mockEmbeddingProvider = { embed: jest.fn() };
  const mockMetrics = { incrementBehaviorSignal: jest.fn() };

  beforeEach(async () => {
    mockLlmFactory.resolve.mockReturnValue({
      strategy: mockStrategy,
      model: ORCHESTRATION_CONSTANTS.SUPERVISOR_MODEL,
    });
    mockStrategy.startChat.mockReturnValue(mockSession);
    mockCircuitBreaker.run.mockImplementation(
      (_key: string, action: () => Promise<unknown>) => action(),
    );
    mockDynamicProviderDb.getProvidersByUser.mockResolvedValue([]);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SupervisorService,
        { provide: McpAuthClientService, useValue: mockMcpAuthClient },
        { provide: LlmStrategyFactory, useValue: mockLlmFactory },
        { provide: CircuitBreakerService, useValue: mockCircuitBreaker },
        { provide: DynamicProviderDbService, useValue: mockDynamicProviderDb },
        { provide: OpenAiEmbeddingProvider, useValue: mockEmbeddingProvider },
        { provide: MetricsRegistryService, useValue: mockMetrics },
      ],
    }).compile();

    service = module.get<SupervisorService>(SupervisorService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('getAvailableAgents', () => {
    it('keeps only providers that are BOTH connected AND registered with a real agent endpoint', async () => {
      mockMcpAuthClient.getConnectionStatus.mockResolvedValue([
        {
          provider_id: 'sql_server',
          is_connected: true,
          status: 'connected',
          connected_at: '2026-01-01',
        },
        {
          provider_id: 'notion',
          is_connected: true,
          status: 'connected',
          connected_at: '2026-01-01',
        },
        {
          provider_id: 'github',
          is_connected: false,
          status: 'not_connected',
          connected_at: null,
        },
      ]);

      const agents = await service.getAvailableAgents('user-1');

      expect(agents).toEqual([
        {
          provider: 'sql_server',
          label: 'SQL Server',
          description: expect.any(String),
        },
      ]);
    });

    it('returns an empty list when nothing is connected', async () => {
      mockMcpAuthClient.getConnectionStatus.mockResolvedValue([
        {
          provider_id: 'sql_server',
          is_connected: false,
          status: 'not_connected',
          connected_at: null,
        },
      ]);

      const agents = await service.getAvailableAgents('user-1');

      expect(agents).toEqual([]);
    });
  });

  describe('plan (Plan-and-Execute, xem accuracy.md — thay cho decide() cũ)', () => {
    const agents = [
      {
        provider: 'sql_server',
        label: 'SQL Server',
        description: 'Truy vấn SQL Server.',
      },
    ];

    it('returns the structured plan from the resolved LLM strategy', async () => {
      mockStrategy.generateStructured.mockResolvedValue({
        action: 'plan',
        steps: [{ agent: 'sql_server', task: 'liệt kê bảng' }],
      });

      const plan = await service.plan('có bao nhiêu bảng?', agents);

      expect(plan).toEqual({
        action: 'plan',
        steps: [{ agent: 'sql_server', task: 'liệt kê bảng' }],
      });
      expect(mockLlmFactory.resolve).toHaveBeenCalledWith(
        ORCHESTRATION_CONSTANTS.SUPERVISOR_MODEL,
      );
      expect(mockStrategy.generateStructured).toHaveBeenCalledWith(
        expect.objectContaining({
          model: ORCHESTRATION_CONSTANTS.SUPERVISOR_MODEL,
          prompt: expect.stringContaining('có bao nhiêu bảng?'),
          systemInstruction: expect.stringContaining(
            'sql_server (SQL Server): Truy vấn SQL Server.',
          ),
        }),
      );
    });

    it('requests the "answer" field in the schema when rounds is empty (turn mới HOẶC chưa có bước nào chạy)', async () => {
      mockStrategy.generateStructured.mockResolvedValue({
        action: 'respond',
        answer: 'Chào bạn!',
      });

      await service.plan('chào bạn', agents);

      expect(mockStrategy.generateStructured).toHaveBeenCalledWith(
        expect.objectContaining({ schema: SUPERVISOR_PLAN_SCHEMA }),
      );
    });

    it('drops the "answer" field from the schema once rounds is non-empty — continueRounds() never uses plan().answer once a step has run, so asking the model to write one just burns tokens for nothing', async () => {
      mockStrategy.generateStructured.mockResolvedValue({ action: 'respond' });

      await service.plan('có bao nhiêu bảng?', agents, [
        { agent: 'sql_server', task: 'liệt kê bảng', result: 'Có 2 bảng' },
      ]);

      expect(mockStrategy.generateStructured).toHaveBeenCalledWith(
        expect.objectContaining({ schema: SUPERVISOR_PLAN_SCHEMA_NO_ANSWER }),
      );
    });

    it('mentions there are no connected agents in the prompt when the list is empty', async () => {
      mockStrategy.generateStructured.mockResolvedValue({
        action: 'respond',
        answer: 'Chào bạn!',
      });

      await service.plan('chào bạn', []);

      expect(mockStrategy.generateStructured).toHaveBeenCalledWith(
        expect.objectContaining({
          systemInstruction: expect.stringContaining('chưa kết nối agent nào'),
        }),
      );
    });

    it('falls back to a safe "respond" plan when the LLM call fails', async () => {
      mockStrategy.generateStructured.mockRejectedValue(
        new Error('provider quota exceeded'),
      );

      const plan = await service.plan('hỏi gì đó', agents);

      expect(plan.action).toBe('respond');
      expect(plan.answer).toEqual(expect.any(String));
    });

    it('sends just the labeled original prompt when there is no history and no previous rounds', async () => {
      mockStrategy.generateStructured.mockResolvedValue({
        action: 'respond',
        answer: 'ok',
      });

      await service.plan('tìm bảng có cột Email', agents, []);

      expect(mockStrategy.generateStructured).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: 'Câu hỏi gốc của user: tìm bảng có cột Email',
        }),
      );
    });

    it('folds previously completed steps into the prompt when re-planning mid-turn', async () => {
      mockStrategy.generateStructured.mockResolvedValue({
        action: 'respond',
        answer: 'ok',
      });

      await service.plan('tìm bảng có cột Email, đếm số dòng bảng đó', agents, [
        {
          agent: 'sql_server',
          task: 'tìm bảng có cột Email',
          result: 'Bảng Users có cột Email',
        },
      ]);

      const sentPrompt =
        mockStrategy.generateStructured.mock.calls[0][0].prompt;
      expect(sentPrompt).toContain(
        'tìm bảng có cột Email, đếm số dòng bảng đó',
      );
      expect(sentPrompt).toContain(
        'Đã delegate agent "sql_server" với yêu cầu "tìm bảng có cột Email" → kết quả: Bảng Users có cột Email',
      );
    });

    it('folds recent chat history into the prompt when provided (Step 7 — Supervisor was blind to it before)', async () => {
      mockStrategy.generateStructured.mockResolvedValue({
        action: 'respond',
        answer: 'ok',
      });

      await service.plan(
        'còn tháng trước thì sao?',
        agents,
        [],
        [
          { role: 'user', text: 'doanh thu tháng này bao nhiêu?' },
          { role: 'model', text: 'Doanh thu tháng này là 100 triệu.' },
        ],
      );

      const sentPrompt =
        mockStrategy.generateStructured.mock.calls[0][0].prompt;
      expect(sentPrompt).toContain('User: doanh thu tháng này bao nhiêu?');
      // Giai đoạn 4 (hướng CHẮC nhất, sau khi cảnh báo-cạnh-dữ-liệu vẫn không
      // đủ) — nội dung câu trả lời CŨ của AI bị ẨN HẲN, không còn xuất hiện
      // nguyên văn trong prompt gửi cho Supervisor nữa (xem bug "14 dòng" ở
      // stage4_step.md). Đảm bảo ở tầng CODE, không phụ thuộc model có nghe
      // lời cảnh báo hay không.
      expect(sentPrompt).not.toContain('Doanh thu tháng này là 100 triệu.');
      expect(sentPrompt).toContain('AI: (nội dung câu trả lời cũ đã ẩn');
      expect(sentPrompt).toContain(
        'Câu hỏi gốc của user: còn tháng trước thì sao?',
      );
    });

    it('Giai đoạn 4 (bug "14 dòng") — hides old AI answer content entirely so Supervisor cannot echo stale/wrong data back, regardless of prompt compliance', async () => {
      mockStrategy.generateStructured.mockResolvedValue({
        action: 'respond',
        answer: 'ok',
      });

      await service.plan(
        'Bảng Orders có bao nhiêu dòng?',
        agents,
        [],
        [
          { role: 'user', text: 'Bảng Orders có bao nhiêu dòng?' },
          { role: 'model', text: 'Bảng Orders có tổng cộng 14 dòng.' },
        ],
      );

      const sentPrompt =
        mockStrategy.generateStructured.mock.calls[0][0].prompt;
      // Số liệu cũ ("14") tuyệt đối KHÔNG được xuất hiện lại trong prompt —
      // đảm bảo chắc chắn (code-level), không phải "hy vọng model bỏ qua nó".
      expect(sentPrompt).not.toContain('14 dòng');
      expect(sentPrompt).toContain(
        'AI: (nội dung câu trả lời cũ đã ẩn khỏi ngữ cảnh này',
      );
      // Câu hỏi CỦA USER (không phải câu trả lời của AI) vẫn còn nguyên —
      // Supervisor vẫn hiểu được NGỮ CẢNH/CHỦ ĐỀ đã hỏi trước đó.
      expect(sentPrompt).toContain('User: Bảng Orders có bao nhiêu dòng?');
    });

    it('Giai đoạn 4, Step 6 — routes the LLM call through the breaker keyed by "llm:<strategy.id>"', async () => {
      mockStrategy.generateStructured.mockResolvedValue({
        action: 'respond',
        answer: 'ok',
      });

      await service.plan('câu hỏi', agents);

      expect(mockCircuitBreaker.run).toHaveBeenCalledWith(
        'llm:gemini',
        expect.any(Function),
      );
    });

    it('Giai đoạn 4, Step 6 — falls back to a safe "respond" plan when the circuit is open (same handling as any other LLM failure)', async () => {
      mockCircuitBreaker.run.mockRejectedValue(
        new Error(
          'THIS PROVIDER IS TEMPORARILY UNAVAILABLE (CIRCUIT BREAKER OPEN) (key=llm:gemini)',
        ),
      );

      const plan = await service.plan('câu hỏi', agents);

      expect(plan.action).toBe('respond');
      expect(mockStrategy.generateStructured).not.toHaveBeenCalled();
    });
  });

  describe('plan — agent-level Tool RAG ranking (Giai đoạn Accuracy v2, mục 2)', () => {
    const manyAgents = (n: number) =>
      Array.from({ length: n }, (_, i) => ({
        provider: `agent_${i}`,
        label: `Agent ${i}`,
        description: `Hệ thống thứ ${i}`,
      }));

    it('does not call the embedding provider when agents.length is within MAX_AGENTS_BEFORE_RANKING — no ranking needed, same behavior as before', async () => {
      mockStrategy.generateStructured.mockResolvedValue({
        action: 'respond',
        answer: 'ok',
      });
      const fewAgents = manyAgents(
        ORCHESTRATION_CONSTANTS.MAX_AGENTS_BEFORE_RANKING,
      );

      await service.plan('câu hỏi', fewAgents);

      expect(mockEmbeddingProvider.embed).not.toHaveBeenCalled();
      const sentInstruction =
        mockStrategy.generateStructured.mock.calls[0][0].systemInstruction;
      // Vẫn liệt kê HẾT — dưới ngưỡng thì không cắt gì cả.
      expect(sentInstruction).toContain('agent_0 (Agent 0)');
      expect(sentInstruction).toContain(
        `agent_${ORCHESTRATION_CONSTANTS.MAX_AGENTS_BEFORE_RANKING - 1}`,
      );
    });

    it('ranks and trims agentListText to top-K when agents.length exceeds the threshold, keeping the agent most relevant to the prompt and noting how many were omitted', async () => {
      mockStrategy.generateStructured.mockResolvedValue({
        action: 'respond',
        answer: 'ok',
      });
      // 8 agent không liên quan + 1 "github" liên quan = 9, vượt ngưỡng 8.
      const lotsOfAgents = [
        ...manyAgents(ORCHESTRATION_CONSTANTS.MAX_AGENTS_BEFORE_RANKING),
        {
          provider: 'github',
          label: 'GitHub',
          description: 'Truy cập repository, issue, pull request trên GitHub.',
        },
      ];
      // Mock embedding thô: text nào chứa "github" thì vector [1,0], còn lại [0,1] —
      // đủ để cosine similarity xếp đúng "github" lên đầu khi query cũng chứa từ đó.
      mockEmbeddingProvider.embed.mockImplementation(async (texts: string[]) =>
        texts.map((t) =>
          t.toLowerCase().includes('github') ? [1, 0] : [0, 1],
        ),
      );

      await service.plan('liệt kê issue trên GitHub', lotsOfAgents);

      // build() embed 1 lần (cả 9 agent) + search() embed 1 lần (query) = 2.
      expect(mockEmbeddingProvider.embed).toHaveBeenCalledTimes(2);
      const sentInstruction =
        mockStrategy.generateStructured.mock.calls[0][0].systemInstruction;
      expect(sentInstruction).toContain('github (GitHub)');
      expect(sentInstruction).toContain(
        'hệ thống khác đã kết nối nhưng không liên quan tới câu hỏi này',
      );
    });

    it('accuracy_problem.md mục 9.4 — reuses the ranking from a passed-in rankingCache on a 2nd plan() call (re-plan) instead of re-embedding the same prompt/agents', async () => {
      mockStrategy.generateStructured.mockResolvedValue({
        action: 'respond',
        answer: 'ok',
      });
      const lotsOfAgents = [
        ...manyAgents(ORCHESTRATION_CONSTANTS.MAX_AGENTS_BEFORE_RANKING),
        {
          provider: 'github',
          label: 'GitHub',
          description: 'Truy cập repository, issue, pull request trên GitHub.',
        },
      ];
      mockEmbeddingProvider.embed.mockImplementation(async (texts: string[]) =>
        texts.map((t) =>
          t.toLowerCase().includes('github') ? [1, 0] : [0, 1],
        ),
      );
      const rankingCache = {};

      // Lần 1 (plan() ban đầu) — chưa có gì trong cache, phải build+search
      // (2 lệnh embed) như bình thường.
      await service.plan(
        'liệt kê issue trên GitHub',
        lotsOfAgents,
        [],
        [],
        rankingCache,
      );
      expect(mockEmbeddingProvider.embed).toHaveBeenCalledTimes(2);

      // Lần 2 (re-plan, CÙNG prompt/agents, CÙNG object rankingCache đã có
      // `.current` từ lần 1) — KHÔNG được gọi embed thêm lần nào nữa.
      await service.plan(
        'liệt kê issue trên GitHub',
        lotsOfAgents,
        [],
        [],
        rankingCache,
      );
      expect(mockEmbeddingProvider.embed).toHaveBeenCalledTimes(2);

      const secondCallInstruction =
        mockStrategy.generateStructured.mock.calls[1][0].systemInstruction;
      expect(secondCallInstruction).toContain('github (GitHub)');
    });

    it('accuracy_problem.md mục 9.4 — a FRESH rankingCache object (new turn) re-embeds normally, not affected by a previous turn', async () => {
      mockStrategy.generateStructured.mockResolvedValue({
        action: 'respond',
        answer: 'ok',
      });
      const lotsOfAgents = manyAgents(
        ORCHESTRATION_CONSTANTS.MAX_AGENTS_BEFORE_RANKING + 1,
      );
      mockEmbeddingProvider.embed.mockImplementation(async (texts: string[]) =>
        texts.map(() => [0, 1]),
      );

      await service.plan('câu hỏi turn 1', lotsOfAgents, [], [], {});
      expect(mockEmbeddingProvider.embed).toHaveBeenCalledTimes(2);

      await service.plan('câu hỏi turn 2', lotsOfAgents, [], [], {});
      expect(mockEmbeddingProvider.embed).toHaveBeenCalledTimes(4);
    });

    it('accuracy_problem.md mục 9.3 — rescues an agent explicitly named in the prompt even when ranking excludes it (compound-intent prompt)', async () => {
      mockStrategy.generateStructured.mockResolvedValue({
        action: 'respond',
        answer: 'ok',
      });
      const agents = [
        ...manyAgents(ORCHESTRATION_CONSTANTS.MAX_AGENTS_BEFORE_RANKING), // 8 agent, chiếm hết top-6
        {
          provider: 'google_sheets',
          label: 'Google Sheets',
          description: 'Ghi dữ liệu vào bảng tính Google Sheets.',
        },
      ];
      // Mô phỏng ĐÚNG lỗ hổng mục 9.3: query (search(), texts.length === 1)
      // luôn ra vector GẦN cụm "agent_0..7", XA "Google Sheets" — dù prompt
      // NHẮC RÕ TÊN "Google Sheets" — mô tả CỦA agent_0..7 (build(), texts
      // dài hơn 1) cũng cố định [1,0] để luôn thắng ranking so với sheets [0,1].
      mockEmbeddingProvider.embed.mockImplementation(async (texts: string[]) =>
        texts.length === 1
          ? [[1, 0]]
          : texts.map((t) =>
              t.toLowerCase().includes('sheets') ? [0, 1] : [1, 0],
            ),
      );

      await service.plan(
        'lấy dữ liệu bán hàng rồi lưu vào Google Sheets',
        agents,
      );

      const sentInstruction =
        mockStrategy.generateStructured.mock.calls[0][0].systemInstruction;
      // google_sheets bị ranking loại (luôn thua agent_0..7) NHƯNG được cứu lại
      // vì prompt gọi thẳng tên nó.
      expect(sentInstruction).toContain('google_sheets (Google Sheets)');
    });

    it('accuracy_problem.md mục 9.3 — does NOT rescue an agent that is neither ranked in top-K NOR named in the prompt — residual risk left as-is', async () => {
      mockStrategy.generateStructured.mockResolvedValue({
        action: 'respond',
        answer: 'ok',
      });
      const agents = [
        ...manyAgents(ORCHESTRATION_CONSTANTS.MAX_AGENTS_BEFORE_RANKING),
        {
          provider: 'google_sheets',
          label: 'Google Sheets',
          description: 'Ghi dữ liệu vào bảng tính Google Sheets.',
        },
      ];
      mockEmbeddingProvider.embed.mockImplementation(async (texts: string[]) =>
        texts.length === 1
          ? [[1, 0]]
          : texts.map((t) =>
              t.toLowerCase().includes('sheets') ? [0, 1] : [1, 0],
            ),
      );

      // Prompt KHÔNG nhắc tên "Google Sheets" — chỉ nói ý định ngầm.
      await service.plan('lấy dữ liệu bán hàng rồi lưu kết quả lại', agents);

      const sentInstruction =
        mockStrategy.generateStructured.mock.calls[0][0].systemInstruction;
      expect(sentInstruction).not.toContain('google_sheets');
      expect(sentInstruction).toContain(
        'hệ thống khác đã kết nối nhưng không liên quan tới câu hỏi này',
      );
    });

    it('accuracy_problem.md mục 9.3 — does not rescue an agent whose label is too short (MIN_AGENT_LABEL_LENGTH_FOR_RESCUE) to avoid false positives', async () => {
      mockStrategy.generateStructured.mockResolvedValue({
        action: 'respond',
        answer: 'ok',
      });
      const agents = [
        ...manyAgents(ORCHESTRATION_CONSTANTS.MAX_AGENTS_BEFORE_RANKING),
        {
          provider: 'short_label_agent',
          label: 'X',
          description: 'Hệ thống nhãn ngắn.',
        },
      ];
      mockEmbeddingProvider.embed.mockImplementation(async (texts: string[]) =>
        texts.length === 1
          ? [[1, 0]]
          : texts.map((t) =>
              t.toLowerCase().includes('nhãn ngắn') ? [0, 1] : [1, 0],
            ),
      );

      // Prompt tình cờ chứa ký tự "x" — KHÔNG được rescue vì nhãn quá ngắn.
      await service.plan('lấy dữ liệu x rồi tổng hợp lại', agents);

      const sentInstruction =
        mockStrategy.generateStructured.mock.calls[0][0].systemInstruction;
      expect(sentInstruction).not.toContain('short_label_agent');
    });

    it('accuracy_problem.md mục 13 — rank RIÊNG từng mệnh đề (tách theo "rồi") thay vì 1 vector chung, cứu được agent cho Ý ĐỊNH NGẦM không hề gọi tên (rescueNamedAgents KHÔNG can thiệp được ở case này)', async () => {
      mockStrategy.generateStructured.mockResolvedValue({
        action: 'respond',
        answer: 'ok',
      });
      const agents = [
        ...manyAgents(ORCHESTRATION_CONSTANTS.MAX_AGENTS_BEFORE_RANKING),
        {
          provider: 'notes_app',
          label: 'Notion',
          description: 'Ghi chú và tài liệu.',
        },
      ];
      mockEmbeddingProvider.embed.mockImplementation(
        async (texts: string[]) => {
          if (texts.length > 1) {
            // build() — mô tả agent_0..7 luôn [1,0], notes_app (mô tả chứa
            // "ghi chú") luôn [0,1].
            return texts.map((t) =>
              t.toLowerCase().includes('ghi chú') ? [0, 1] : [1, 0],
            );
          }
          // search() — mô phỏng ĐÚNG lỗ hổng mục 13: vector của CẢ CÂU GHÉP
          // (chứa cả 2 ý định) LUÔN lệch về ý định đầu (agent_0..7) — CHỈ
          // mệnh đề ĐÃ TÁCH RIÊNG "ghi chú lại kết quả" mới ra đúng vector
          // khớp notes_app (mô phỏng embedding thật: câu ghép bị ý định mạnh
          // hơn lấn át, mệnh đề riêng thì không).
          return texts[0] === 'ghi chú lại kết quả' ? [[0, 1]] : [[1, 0]];
        },
      );

      // Không hề gọi tên "Notion" — chỉ nói ý định ngầm ("ghi chú lại").
      await service.plan(
        'lấy dữ liệu bán hàng rồi ghi chú lại kết quả',
        agents,
      );

      const sentInstruction =
        mockStrategy.generateStructured.mock.calls[0][0].systemInstruction;
      expect(sentInstruction).toContain('notes_app (Notion)');
    });

    it('accuracy_problem.md mục 16 — caps the number of clauses searched when the prompt repeats a sequencing word many times (unbounded embedding fan-out)', async () => {
      mockStrategy.generateStructured.mockResolvedValue({
        action: 'respond',
        answer: 'ok',
      });
      const lotsOfAgents = manyAgents(
        ORCHESTRATION_CONSTANTS.MAX_AGENTS_BEFORE_RANKING + 1,
      );
      mockEmbeddingProvider.embed.mockImplementation(async (texts: string[]) =>
        texts.map(() => [0, 1]),
      );
      const repeatedRoi = Array.from(
        { length: 20 },
        (_, i) => `làm việc ${i}`,
      ).join(' rồi ');

      await service.plan(repeatedRoi, lotsOfAgents);

      // build() = 1 lệnh embed cho agent list, search() = ĐÚNG
      // MAX_PROMPT_CLAUSES_FOR_RANKING lệnh (không phải 21).
      expect(mockEmbeddingProvider.embed).toHaveBeenCalledTimes(
        1 + ORCHESTRATION_CONSTANTS.MAX_PROMPT_CLAUSES_FOR_RANKING,
      );
    });

    it('falls back to listing every agent unranked (no throw) when the embedding provider fails', async () => {
      mockStrategy.generateStructured.mockResolvedValue({
        action: 'respond',
        answer: 'ok',
      });
      const lotsOfAgents = manyAgents(
        ORCHESTRATION_CONSTANTS.MAX_AGENTS_BEFORE_RANKING + 1,
      );
      mockEmbeddingProvider.embed.mockRejectedValue(
        new Error('OPENAI_EMBEDDING_API_KEY not configured'),
      );

      await service.plan('câu hỏi', lotsOfAgents);

      const sentInstruction =
        mockStrategy.generateStructured.mock.calls[0][0].systemInstruction;
      expect(sentInstruction).toContain('agent_0 (Agent 0)');
      expect(sentInstruction).toContain(
        `agent_${ORCHESTRATION_CONSTANTS.MAX_AGENTS_BEFORE_RANKING} (Agent ${ORCHESTRATION_CONSTANTS.MAX_AGENTS_BEFORE_RANKING})`,
      );
      expect(sentInstruction).not.toContain('không liên quan tới câu hỏi này');
    });
  });

  describe('plan — đo tần suất positional bias (accuracy_problem.md mục 1, bước 1)', () => {
    it('logs an ambiguous-cluster warning when the chosen agent has a description similar to another connected agent', async () => {
      const warnSpy = jest.spyOn(Logger.prototype, 'warn');
      const agents = [
        {
          provider: 'google_docs',
          label: 'Google Docs',
          description: 'Đọc và chỉnh sửa nội dung Google Docs.',
        },
        {
          provider: 'notion',
          label: 'Notion',
          description: 'Đọc và chỉnh sửa trang/database trên Notion.',
        },
      ];
      mockStrategy.generateStructured.mockResolvedValue({
        action: 'plan',
        steps: [{ agent: 'google_docs', task: 'lưu thông tin này lại' }],
      });

      const plan = await service.plan('lưu thông tin này lại', agents);

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('[ambiguous-agent-cluster]'),
      );
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('candidates=google_docs,notion'),
      );
      // accuracy_problem.md mục 1 — plan() giờ CŨNG trả cluster mơ hồ ra ngoài
      // (không chỉ log) để TurnResolverService tự quyết định có hỏi lại user
      // hay không (ENABLE_CLARIFICATION_HITL).
      expect(plan.ambiguousCandidates?.map((c) => c.provider).sort()).toEqual([
        'google_docs',
        'notion',
      ]);
    });

    it('does not log anything when connected agents have clearly distinct descriptions', async () => {
      const warnSpy = jest.spyOn(Logger.prototype, 'warn');
      const agents = [
        {
          provider: 'sql_server',
          label: 'SQL Server',
          description: 'Truy vấn schema và dữ liệu trên SQL Server của bạn.',
        },
        {
          provider: 'github',
          label: 'GitHub',
          description: 'Truy cập repository, issue, pull request trên GitHub.',
        },
      ];
      mockStrategy.generateStructured.mockResolvedValue({
        action: 'plan',
        steps: [{ agent: 'sql_server', task: 'liệt kê bảng' }],
      });

      const plan = await service.plan('liệt kê bảng trong SQL Server', agents);

      expect(warnSpy).not.toHaveBeenCalledWith(
        expect.stringContaining('[ambiguous-agent-cluster]'),
      );
      expect(plan.ambiguousCandidates).toBeUndefined();
    });

    it('does not log anything when action is "respond" (no agent chosen)', async () => {
      const warnSpy = jest.spyOn(Logger.prototype, 'warn');
      const agents = [
        {
          provider: 'google_docs',
          label: 'Google Docs',
          description: 'Đọc và chỉnh sửa nội dung Google Docs.',
        },
        {
          provider: 'notion',
          label: 'Notion',
          description: 'Đọc và chỉnh sửa trang/database trên Notion.',
        },
      ];
      mockStrategy.generateStructured.mockResolvedValue({
        action: 'respond',
        answer: 'Chào bạn!',
      });

      await service.plan('chào bạn', agents);

      expect(warnSpy).not.toHaveBeenCalledWith(
        expect.stringContaining('[ambiguous-agent-cluster]'),
      );
    });

    it('does not call the embedding provider — thuần lexical, không tốn thêm lời gọi LLM/embedding nào', async () => {
      const agents = [
        {
          provider: 'google_docs',
          label: 'Google Docs',
          description: 'Đọc và chỉnh sửa nội dung Google Docs.',
        },
        {
          provider: 'notion',
          label: 'Notion',
          description: 'Đọc và chỉnh sửa trang/database trên Notion.',
        },
      ];
      mockStrategy.generateStructured.mockResolvedValue({
        action: 'plan',
        steps: [{ agent: 'google_docs', task: 'lưu thông tin này lại' }],
      });

      await service.plan('lưu thông tin này lại', agents);

      expect(mockEmbeddingProvider.embed).not.toHaveBeenCalled();
    });
  });

  describe('plan — model tiering theo độ khó (Giai đoạn Accuracy v2, mục 4)', () => {
    const agents = [
      {
        provider: 'sql_server',
        label: 'SQL Server',
        description: 'Truy vấn SQL Server.',
      },
    ];
    const originalPlanningModel = process.env.SUPERVISOR_PLANNING_MODEL;
    const originalSupervisorModel = process.env.SUPERVISOR_MODEL;

    afterEach(() => {
      if (originalPlanningModel === undefined) {
        delete process.env.SUPERVISOR_PLANNING_MODEL;
      } else {
        process.env.SUPERVISOR_PLANNING_MODEL = originalPlanningModel;
      }
      if (originalSupervisorModel === undefined) {
        delete process.env.SUPERVISOR_MODEL;
      } else {
        process.env.SUPERVISOR_MODEL = originalSupervisorModel;
      }
    });

    it('resolves the model via SUPERVISOR_PLANNING_MODEL when set, overriding SUPERVISOR_MODEL', async () => {
      process.env.SUPERVISOR_PLANNING_MODEL = 'gpt-4o';
      process.env.SUPERVISOR_MODEL = 'gpt-4o-mini';
      mockStrategy.generateStructured.mockResolvedValue({
        action: 'respond',
        answer: 'ok',
      });

      await service.plan('câu hỏi', agents);

      expect(mockLlmFactory.resolve).toHaveBeenCalledWith('gpt-4o');
    });

    it('falls back to SUPERVISOR_MODEL when SUPERVISOR_PLANNING_MODEL is not set — unchanged from before this feature existed', async () => {
      delete process.env.SUPERVISOR_PLANNING_MODEL;
      process.env.SUPERVISOR_MODEL = 'gpt-4o-mini';
      mockStrategy.generateStructured.mockResolvedValue({
        action: 'respond',
        answer: 'ok',
      });

      await service.plan('câu hỏi', agents);

      expect(mockLlmFactory.resolve).toHaveBeenCalledWith('gpt-4o-mini');
    });

    it('does not affect evaluate() — it keeps resolving via SUPERVISOR_MODEL regardless of SUPERVISOR_PLANNING_MODEL', async () => {
      process.env.SUPERVISOR_PLANNING_MODEL = 'gpt-4o';
      process.env.SUPERVISOR_MODEL = 'gpt-4o-mini';
      mockStrategy.generateStructured.mockResolvedValue({
        verdict: 'continue',
      });

      await service.evaluate(
        'câu hỏi gốc',
        {
          agent: 'sql_server',
          task: 'lấy danh sách diễn viên',
          result: '⚠️ Lỗi: timeout khi query',
        },
        [{ agent: 'sql_server', task: 'chèn vào bảng users' }],
      );

      expect(mockLlmFactory.resolve).toHaveBeenCalledWith('gpt-4o-mini');
    });
  });

  describe('evaluate (Plan-and-Execute — gọi SAU MỖI bước, trước khi qua bước kế)', () => {
    const completedStep = {
      agent: 'sql_server',
      task: 'lấy danh sách diễn viên',
      result: '⚠️ Lỗi: timeout khi query',
    };

    it('returns "done" immediately WITHOUT calling the LLM when there are no remaining steps', async () => {
      const verdict = await service.evaluate('câu hỏi gốc', completedStep, []);

      expect(verdict).toEqual({ verdict: 'done' });
      expect(mockStrategy.generateStructured).not.toHaveBeenCalled();
    });

    it('accuracy_problem.md — still calls the LLM even when the completed step looks clearly successful (no rule-based "continue" shortcut anymore — "not an obvious error" is not proof the result is relevant to originalPrompt)', async () => {
      mockStrategy.generateStructured.mockResolvedValue({
        verdict: 'continue',
      });
      const clearlySuccessfulStep = {
        agent: 'sql_server',
        task: 'lấy danh sách diễn viên',
        result: '[{"name":"A"},{"name":"B"}]',
      };

      const verdict = await service.evaluate(
        'câu hỏi gốc',
        clearlySuccessfulStep,
        [{ agent: 'sql_server', task: 'chèn vào bảng users' }],
      );

      expect(verdict).toEqual({ verdict: 'continue' });
      expect(mockStrategy.generateStructured).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: expect.stringContaining('câu hỏi gốc'),
        }),
      );
    });

    it('does NOT skip the LLM call when the result is empty — cannot rule-based decide, must ask', async () => {
      mockStrategy.generateStructured.mockResolvedValue({
        verdict: 'continue',
      });
      const emptyResultStep = {
        agent: 'sql_server',
        task: 'lấy danh sách diễn viên',
        result: '   ',
      };

      await service.evaluate('câu hỏi gốc', emptyResultStep, [
        { agent: 'sql_server', task: 'chèn vào bảng users' },
      ]);

      expect(mockStrategy.generateStructured).toHaveBeenCalled();
    });

    it('does NOT skip the LLM call when the result says the agent was unavailable', async () => {
      mockStrategy.generateStructured.mockResolvedValue({ verdict: 're-plan' });
      const unavailableStep = {
        agent: 'sql_server',
        task: 'lấy danh sách diễn viên',
        result:
          'Agent này chưa khả dụng (chưa kết nối hoặc chưa có hạ tầng) — bỏ qua, không thực hiện được phần việc này.',
      };

      await service.evaluate('câu hỏi gốc', unavailableStep, [
        { agent: 'sql_server', task: 'chèn vào bảng users' },
      ]);

      expect(mockStrategy.generateStructured).toHaveBeenCalled();
    });

    it('returns the structured verdict from the LLM when there ARE remaining steps', async () => {
      mockStrategy.generateStructured.mockResolvedValue({
        verdict: 'continue',
      });

      const verdict = await service.evaluate('câu hỏi gốc', completedStep, [
        { agent: 'sql_server', task: 'chèn vào bảng users' },
      ]);

      expect(verdict).toEqual({ verdict: 'continue' });
      expect(mockStrategy.generateStructured).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: expect.stringContaining('lấy danh sách diễn viên'),
        }),
      );
    });

    it('falls back to "continue" (bám kế hoạch cũ) when the LLM call fails — MAX_SUPERVISOR_ROUNDS is still the safety net if the plan is really wrong', async () => {
      mockStrategy.generateStructured.mockRejectedValue(
        new Error('provider is down'),
      );

      const verdict = await service.evaluate('câu hỏi gốc', completedStep, [
        { agent: 'sql_server', task: 'chèn vào bảng users' },
      ]);

      expect(verdict).toEqual({ verdict: 'continue' });
    });

    // accuracy_problem.md mục 14 — 2 lớp giảm tần suất evaluate() sai.
    describe('mục 14 — đánh dấu mustExecute trong prompt + chặn "done" khỏi schema khi còn bước bắt buộc', () => {
      it('marks each remaining step with mustExecute in the prompt, so the LLM sees the SAME signal plan() already computed', async () => {
        mockStrategy.generateStructured.mockResolvedValue({
          verdict: 'continue',
        });

        await service.evaluate('câu hỏi gốc', completedStep, [
          {
            agent: 'sql_server',
            task: 'tính tổng doanh số',
            mustExecute: true,
          },
          {
            agent: 'sql_server',
            task: 'tra thêm nguồn khác cho chắc',
            mustExecute: false,
          },
        ]);

        const sentPrompt =
          mockStrategy.generateStructured.mock.calls[0][0].prompt;
        expect(sentPrompt).toContain(
          'tính tổng doanh số [BẮT BUỘC — không được bỏ qua]',
        );
        expect(sentPrompt).toContain(
          'tra thêm nguồn khác cho chắc [không bắt buộc — có thể bỏ qua nếu đã đủ dữ liệu]',
        );
      });

      it('uses SUPERVISOR_EVALUATE_SCHEMA_NO_DONE (no "done" in enum) when a remaining step has mustExecute: true — model CANNOT choose "done" even if it wanted to', async () => {
        mockStrategy.generateStructured.mockResolvedValue({
          verdict: 'continue',
        });

        await service.evaluate('câu hỏi gốc', completedStep, [
          {
            agent: 'sql_server',
            task: 'tính tổng doanh số',
            mustExecute: true,
          },
        ]);

        const sentSchema =
          mockStrategy.generateStructured.mock.calls[0][0].schema;
        expect(sentSchema.properties.verdict.enum).toEqual([
          'continue',
          're-plan',
        ]);
        const sentPrompt =
          mockStrategy.generateStructured.mock.calls[0][0].prompt;
        expect(sentPrompt).toContain('"done" không phải lựa chọn hợp lệ');
      });

      it('still uses the normal schema (with "done") when no remaining step is must-execute or keyword-matched', async () => {
        mockStrategy.generateStructured.mockResolvedValue({
          verdict: 'continue',
        });

        await service.evaluate('câu hỏi gốc', completedStep, [
          {
            agent: 'petstore',
            task: 'xem lại nguồn dữ liệu khác',
            mustExecute: false,
          },
        ]);

        const sentSchema =
          mockStrategy.generateStructured.mock.calls[0][0].schema;
        expect(sentSchema.properties.verdict.enum).toEqual([
          'continue',
          're-plan',
          'done',
        ]);
      });

      it('also blocks "done" via keyword fallback (COMPUTE_TASK_KEYWORDS) even when mustExecute is missing/undefined on the remaining step', async () => {
        mockStrategy.generateStructured.mockResolvedValue({
          verdict: 'continue',
        });

        await service.evaluate('câu hỏi gốc', completedStep, [
          { agent: 'sql_server', task: 'tính trung bình đơn hàng' },
        ]);

        const sentSchema =
          mockStrategy.generateStructured.mock.calls[0][0].schema;
        expect(sentSchema.properties.verdict.enum).toEqual([
          'continue',
          're-plan',
        ]);
      });
    });

    it('accuracy_problem.md mục 5 — completedStep.result chưa qua capRoundResults() (chỉ áp dụng ở round SAU) nên KHÔNG được nhồi thẳng RAW không cap vào prompt evaluate() — cap theo ĐÚNG ngân sách model, không phải hằng số cứng cũ, và KHÔNG cắt case cỡ thật (500 dòng)', async () => {
      mockStrategy.generateStructured.mockResolvedValue({
        verdict: 'continue',
      });
      const fiveHundredRows = JSON.stringify(
        Array.from({ length: 500 }, (_, i) => ({ id: i, name: `KH ${i}` })),
      );

      await service.evaluate(
        'câu hỏi gốc',
        {
          agent: 'sql_server',
          task: 'lấy 500 khách hàng',
          result: fiveHundredRows,
        },
        [{ agent: 'sheets', task: 'ghi vào Google Sheets' }],
      );

      const promptSent = mockStrategy.generateStructured.mock.calls[0][0]
        .prompt as string;
      expect(promptSent).toContain('"id":0');
      expect(promptSent).toContain('"id":499');
      expect(promptSent).not.toContain('truncated');
    });

    it('accuracy_problem.md mục 5 — vẫn cap đúng khi completedStep.result vượt XA ngân sách đã nới rộng theo model (chặn timeout cũ tái diễn ở evaluate())', async () => {
      mockStrategy.generateStructured.mockResolvedValue({
        verdict: 'continue',
      });
      const hugeResult = 'z'.repeat(160_000);

      await service.evaluate(
        'câu hỏi gốc',
        {
          agent: 'sql_server',
          task: 'lấy dữ liệu khổng lồ',
          result: hugeResult,
        },
        [{ agent: 'sheets', task: 'ghi vào Google Sheets' }],
      );

      const promptSent = mockStrategy.generateStructured.mock.calls[0][0]
        .prompt as string;
      expect(promptSent.length).toBeLessThan(hugeResult.length);
      expect(promptSent).toContain('[truncated');
    });

    it('Giai đoạn 4, Step 6 — routes the LLM call through the breaker keyed by "llm:<strategy.id>"', async () => {
      mockStrategy.generateStructured.mockResolvedValue({
        verdict: 'continue',
      });

      await service.evaluate('câu hỏi gốc', completedStep, [
        { agent: 'sql_server', task: 'chèn vào bảng users' },
      ]);

      expect(mockCircuitBreaker.run).toHaveBeenCalledWith(
        'llm:gemini',
        expect.any(Function),
      );
    });
  });

  describe('synthesize', () => {
    it('asks the LLM to summarize all collected rounds and returns its answer', async () => {
      mockSession.sendMessage.mockResolvedValue({
        text: 'Tổng hợp: A có 5 bảng, B có 10 dòng.',
      });

      const answer = await service.synthesize('câu hỏi gốc', [
        { agent: 'sql_server', task: 'đếm bảng', result: 'A có 5 bảng' },
        { agent: 'sql_server', task: 'đếm dòng', result: 'B có 10 dòng' },
      ]);

      expect(answer).toBe('Tổng hợp: A có 5 bảng, B có 10 dòng.');
      const call = mockSession.sendMessage.mock.calls[0][0];
      expect(call).toContain('A có 5 bảng');
      expect(call).toContain('B có 10 dòng');
    });

    it('falls back to the raw error message when the LLM call fails', async () => {
      mockSession.sendMessage.mockRejectedValue(new Error('provider is down'));

      const answer = await service.synthesize('câu hỏi gốc', [
        { agent: 'sql_server', task: 'đếm bảng', result: 'A có 5 bảng' },
      ]);

      expect(answer).toContain('provider is down');
    });

    it('Giai đoạn 4, Step 6 — routes the LLM call through the breaker keyed by "llm:<strategy.id>"', async () => {
      mockSession.sendMessage.mockResolvedValue({ text: 'ok' });

      await service.synthesize('câu hỏi gốc', []);

      expect(mockCircuitBreaker.run).toHaveBeenCalledWith(
        'llm:gemini',
        expect.any(Function),
      );
    });

    it('accuracy_problem.md — does NOT truncate a realistic bulk-transfer case (VD 500 dòng SQL → Sheets, ~40-50k ký tự) — ngân sách cap giờ tính theo context window THẬT của model (gpt-4o-mini = 128K token), không phải hằng số 6000 không liên quan gì tới model', async () => {
      mockSession.sendMessage.mockResolvedValue({ text: 'ok' });

      const fiveHundredRows = JSON.stringify(
        Array.from({ length: 500 }, (_, i) => ({
          id: i,
          name: `Khách hàng ${i}`,
          email: `customer${i}@example.com`,
          totalSpent: (i * 137) % 5000,
        })),
      );
      const rounds = [
        {
          agent: 'sql_server',
          task: 'lấy toàn bộ 500 khách hàng',
          result: fiveHundredRows,
        },
      ];
      // Xác nhận setup đúng cỡ "dữ liệu lớn" đã bàn — vượt xa MAX_TOOL_RESULT_CHARS
      // cũ (6000), nhưng vẫn nằm gọn trong context window thật của gpt-4o-mini.
      expect(rounds[0].result.length).toBeGreaterThan(6000);

      await service.synthesize('liệt kê toàn bộ khách hàng', rounds);

      const promptSent = mockSession.sendMessage.mock.calls[0][0] as string;
      // KHÔNG bị cắt — toàn bộ 500 bản ghi (id cuối cùng = 499) phải còn nguyên,
      // không chỉ 1 phần đầu/cuối như hành vi CŨ (cap cứng 6000).
      expect(promptSent).toContain('"id":0');
      expect(promptSent).toContain('"id":499');
      expect(promptSent).not.toContain('truncated');
    });

    it('accuracy_problem.md — vẫn cap đúng cách (không mất round) khi dữ liệu VƯỢT XA cả ngân sách đã nới rộng theo model', async () => {
      mockSession.sendMessage.mockResolvedValue({ text: 'ok' });

      // Mỗi round ~20.000 ký tự × 10 round = ~200.000 ký tự — vượt cả ngân sách
      // đã tính theo context window thật của gpt-4o-mini (128K token × 4 ×
      // 0.3 ≈ 153.600 ký tự), để xác nhận cơ chế cap-từng-round-riêng vẫn hoạt
      // động đúng (không xoá sổ round nào) ngay cả khi dữ liệu THẬT SỰ khổng lồ.
      const hugeRowsAsJson = (label: string) =>
        JSON.stringify(
          Array.from({ length: 500 }, (_, i) => ({
            id: i,
            name: `${label}-customer-${i}`,
            email: `${label.toLowerCase()}${i}@example.com`,
            note: 'lorem ipsum dolor sit amet consectetur adipiscing elit '.repeat(
              2,
            ),
          })),
        );
      const rounds = Array.from({ length: 10 }, (_, i) => ({
        agent: 'sql_server',
        task: `lấy dữ liệu batch ${i}`,
        result: hugeRowsAsJson(`batch${i}`),
      }));
      const totalRawLength = rounds.reduce(
        (sum, r) => sum + r.result.length,
        0,
      );
      expect(totalRawLength).toBeGreaterThan(150_000);

      await service.synthesize('liệt kê toàn bộ khách hàng', rounds);

      const promptSent = mockSession.sendMessage.mock.calls[0][0] as string;
      expect(promptSent.length).toBeLessThan(totalRawLength);
      // Cả 10 nhãn round vẫn phải xuất hiện — cap chỉ cắt DỮ LIỆU mỗi round,
      // không được xoá sổ nguyên round nào khỏi ngữ cảnh.
      for (let i = 0; i < 10; i++) {
        expect(promptSent).toContain(`batch ${i}`);
      }
    });
  });
});
