import { Test, TestingModule } from '@nestjs/testing';
import { ORCHESTRATION_CONSTANTS } from '@slack/constants';
import { SupervisorService } from './supervisor.service';
import { McpAuthClientService } from '../mcp-auth/mcp-auth-client.service';
import { LlmStrategyFactory } from './strategy/llm-strategy.factory';
import { CircuitBreakerService } from '../common/circuit-breaker.service';

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
  const mockStrategy = { id: 'gemini', generateStructured: jest.fn() };
  const mockLlmFactory = { resolve: jest.fn() };
  // Pass-through mặc định — giữ nguyên hành vi mọi test đã có từ trước Step 6.
  const mockCircuitBreaker = {
    run: jest.fn((_key: string, action: () => Promise<unknown>) => action()),
  };

  beforeEach(async () => {
    mockLlmFactory.resolve.mockReturnValue({
      strategy: mockStrategy,
      model: ORCHESTRATION_CONSTANTS.SUPERVISOR_MODEL,
    });
    mockCircuitBreaker.run.mockImplementation(
      (_key: string, action: () => Promise<unknown>) => action(),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SupervisorService,
        { provide: McpAuthClientService, useValue: mockMcpAuthClient },
        { provide: LlmStrategyFactory, useValue: mockLlmFactory },
        { provide: CircuitBreakerService, useValue: mockCircuitBreaker },
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

  describe('decide', () => {
    const agents = [
      {
        provider: 'sql_server',
        label: 'SQL Server',
        description: 'Truy vấn SQL Server.',
      },
    ];

    it('returns the structured decision from the resolved LLM strategy', async () => {
      mockStrategy.generateStructured.mockResolvedValue({
        action: 'delegate',
        delegations: [{ agent: 'sql_server', task: 'liệt kê bảng' }],
      });

      const decision = await service.decide('có bao nhiêu bảng?', agents);

      expect(decision).toEqual({
        action: 'delegate',
        delegations: [{ agent: 'sql_server', task: 'liệt kê bảng' }],
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

    it('mentions there are no connected agents in the prompt when the list is empty', async () => {
      mockStrategy.generateStructured.mockResolvedValue({
        action: 'respond',
        answer: 'Chào bạn!',
      });

      await service.decide('chào bạn', []);

      expect(mockStrategy.generateStructured).toHaveBeenCalledWith(
        expect.objectContaining({
          systemInstruction: expect.stringContaining('chưa kết nối agent nào'),
        }),
      );
    });

    it('falls back to a safe "respond" decision when the LLM call fails', async () => {
      mockStrategy.generateStructured.mockRejectedValue(
        new Error('provider quota exceeded'),
      );

      const decision = await service.decide('hỏi gì đó', agents);

      expect(decision.action).toBe('respond');
      expect(decision.answer).toEqual(expect.any(String));
    });

    it('sends just the labeled original prompt when there is no history and no previous rounds', async () => {
      mockStrategy.generateStructured.mockResolvedValue({
        action: 'respond',
        answer: 'ok',
      });

      await service.decide('tìm bảng có cột Email', agents, []);

      expect(mockStrategy.generateStructured).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: 'Câu hỏi gốc của user: tìm bảng có cột Email',
        }),
      );
    });

    it('folds previous delegate rounds into the prompt from round 2 onward (Step 3)', async () => {
      mockStrategy.generateStructured.mockResolvedValue({
        action: 'respond',
        answer: 'ok',
      });

      await service.decide(
        'tìm bảng có cột Email, đếm số dòng bảng đó',
        agents,
        [
          {
            agent: 'sql_server',
            task: 'tìm bảng có cột Email',
            result: 'Bảng Users có cột Email',
          },
        ],
      );

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

      await service.decide(
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
      expect(sentPrompt).toContain('AI: Doanh thu tháng này là 100 triệu.');
      expect(sentPrompt).toContain(
        'Câu hỏi gốc của user: còn tháng trước thì sao?',
      );
    });

    it('Giai đoạn 4, Step 6 — routes the LLM call through the breaker keyed by "llm:<strategy.id>"', async () => {
      mockStrategy.generateStructured.mockResolvedValue({
        action: 'respond',
        answer: 'ok',
      });

      await service.decide('câu hỏi', agents);

      expect(mockCircuitBreaker.run).toHaveBeenCalledWith(
        'llm:gemini',
        expect.any(Function),
      );
    });

    it('Giai đoạn 4, Step 6 — falls back to a safe "respond" decision when the circuit is open (same handling as any other LLM failure)', async () => {
      mockCircuitBreaker.run.mockRejectedValue(
        new Error(
          'THIS PROVIDER IS TEMPORARILY UNAVAILABLE (CIRCUIT BREAKER OPEN) (key=llm:gemini)',
        ),
      );

      const decision = await service.decide('câu hỏi', agents);

      expect(decision.action).toBe('respond');
      expect(mockStrategy.generateStructured).not.toHaveBeenCalled();
    });
  });

  describe('synthesize', () => {
    it('asks the LLM to summarize all collected rounds and returns its answer', async () => {
      mockStrategy.generateStructured.mockResolvedValue({
        answer: 'Tổng hợp: A có 5 bảng, B có 10 dòng.',
      });

      const answer = await service.synthesize('câu hỏi gốc', [
        { agent: 'sql_server', task: 'đếm bảng', result: 'A có 5 bảng' },
        { agent: 'sql_server', task: 'đếm dòng', result: 'B có 10 dòng' },
      ]);

      expect(answer).toBe('Tổng hợp: A có 5 bảng, B có 10 dòng.');
      const call = mockStrategy.generateStructured.mock.calls[0][0];
      expect(call.prompt).toContain('A có 5 bảng');
      expect(call.prompt).toContain('B có 10 dòng');
    });

    it('falls back to the raw error message when the LLM call fails', async () => {
      mockStrategy.generateStructured.mockRejectedValue(
        new Error('provider is down'),
      );

      const answer = await service.synthesize('câu hỏi gốc', [
        { agent: 'sql_server', task: 'đếm bảng', result: 'A có 5 bảng' },
      ]);

      expect(answer).toContain('provider is down');
    });

    it('Giai đoạn 4, Step 6 — routes the LLM call through the breaker keyed by "llm:<strategy.id>"', async () => {
      mockStrategy.generateStructured.mockResolvedValue({ answer: 'ok' });

      await service.synthesize('câu hỏi gốc', []);

      expect(mockCircuitBreaker.run).toHaveBeenCalledWith(
        'llm:gemini',
        expect.any(Function),
      );
    });
  });
});
