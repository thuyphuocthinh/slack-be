import { Test, TestingModule } from '@nestjs/testing';
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

  describe('evaluate (Plan-and-Execute — gọi SAU MỖI bước, trước khi qua bước kế)', () => {
    // Kết quả trông "đáng ngờ" (khớp dấu hiệu lỗi đã biết) — CHƯA đủ để rule
    // đơn giản tự quyết, phải hỏi LLM. Test riêng bên dưới ("skips the LLM
    // call...") mới dùng kết quả THÀNH CÔNG rõ ràng.
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

    it('skips the LLM call and returns "continue" directly (rule-based, xem accuracy.md) when the completed step clearly succeeded with real data', async () => {
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
      expect(mockStrategy.generateStructured).not.toHaveBeenCalled();
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
  });
});
