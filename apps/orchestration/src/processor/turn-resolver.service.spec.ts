import { Test, TestingModule } from '@nestjs/testing';
import { IProcessAiTriggerJobData } from '@slack/queue';
import { ORCHESTRATION_CONSTANTS } from '@slack/constants';
import { TurnResolverService } from './turn-resolver.service';
import { MessageClientService } from '../message-client.service';
import { ReactLoopService } from '../llm/react-loop.service';
import { SupervisorService } from '../llm/supervisor.service';
import { AgentStreamService } from '../socket/agent-stream.service';
import { ApprovalRequiredError } from '../llm/approval-required.error';
import { AgentCancellationService } from '../cancellation/agent-cancellation.service';
import { TurnCancelledError } from '../llm/turn-cancelled.error';
import { CheckpointPauseService } from './checkpoint-pause.service';
import { MetricsRegistryService } from '../common/metrics-registry.service';
import { MemoryManagerService } from '../memory/memory-manager.service';

// react-loop.service.ts / supervisor.service.ts import @slack/common ở module
// scope — mock thẳng barrel để tránh kéo theo "nanoid" (ESM-only).
jest.mock('@slack/common', () => ({ extractTextFromMcpResult: jest.fn() }));

describe('TurnResolverService (Plan-and-Execute, xem accuracy.md)', () => {
  let service: TurnResolverService;

  const mockMessageClient = {
    getMessageText: jest.fn(),
    getRecentHistory: jest.fn(),
  };
  const mockReactLoop = { run: jest.fn() };
  const mockSupervisor = {
    getAvailableAgents: jest.fn(),
    plan: jest.fn(),
    evaluate: jest.fn(),
    synthesize: jest.fn(),
    checkCumulativeQuantity: jest
      .fn()
      .mockResolvedValue({ requiredCount: 0, achievedCount: 0 }),
  };
  const mockAgentStream = { emitStep: jest.fn() };
  const mockCancellation = { isCancelled: jest.fn().mockResolvedValue(false) };
  const mockCheckpointPause = {
    pauseForApproval: jest.fn(),
    pauseForClarification: jest.fn(),
  };
  const mockMetrics = { incrementBehaviorSignal: jest.fn() };
  const mockMemoryManager = {
    buildBudget: jest.fn().mockReturnValue({
      toolResultCharBudget: 6000,
      memoryCharBudget: 600,
      historyCharBudget: 3000,
    }),
    getMemories: jest.fn().mockResolvedValue([]),
    recordUserDeclaredFact: jest.fn().mockResolvedValue(undefined),
  };

  const data: IProcessAiTriggerJobData = {
    userId: 'user-1',
    channelId: 'channel-1',
    workspaceId: 'workspace-1',
    messageId: 'trigger-msg-1',
    botUserId: 'bot-1',
    channelType: 'direct',
  };
  const replyMessageId = 'reply-1';

  const availableAgents = [
    { provider: 'sql_server', label: 'SQL Server', description: 'desc' },
  ];

  beforeEach(async () => {
    mockMessageClient.getMessageText.mockResolvedValue('có bao nhiêu bảng?');
    mockMessageClient.getRecentHistory.mockResolvedValue([]);
    mockSupervisor.getAvailableAgents.mockResolvedValue(availableAgents);
    mockAgentStream.emitStep.mockResolvedValue(undefined);
    mockCancellation.isCancelled.mockResolvedValue(false);
    // Mặc định: hết 1 bước là xong (case phổ biến nhất — plan 1 bước). Test
    // cần chuỗi nhiều bước override riêng bằng continue/re-plan.
    mockSupervisor.evaluate.mockResolvedValue({ verdict: 'done' });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TurnResolverService,
        { provide: MessageClientService, useValue: mockMessageClient },
        { provide: ReactLoopService, useValue: mockReactLoop },
        { provide: SupervisorService, useValue: mockSupervisor },
        { provide: AgentStreamService, useValue: mockAgentStream },
        { provide: AgentCancellationService, useValue: mockCancellation },
        { provide: CheckpointPauseService, useValue: mockCheckpointPause },
        { provide: MetricsRegistryService, useValue: mockMetrics },
        { provide: MemoryManagerService, useValue: mockMemoryManager },
      ],
    }).compile();

    service = module.get<TurnResolverService>(TurnResolverService);
  });

  afterEach(() => jest.clearAllMocks());

  const resolve = (jobData: IProcessAiTriggerJobData = data) =>
    service.resolveAnswer(jobData, replyMessageId);

  it('returns the Supervisor answer directly when action is "respond" — no ReAct loop, no evaluate() involved', async () => {
    mockSupervisor.plan.mockResolvedValue({
      action: 'respond',
      answer: 'Chào bạn!',
    });

    const result = await resolve();

    expect(mockReactLoop.run).not.toHaveBeenCalled();
    expect(mockSupervisor.evaluate).not.toHaveBeenCalled();
    expect(result).toEqual({ content: 'Chào bạn!', toolCalls: undefined });
  });

  it('falls back to a default message when Supervisor responds with action="respond" but no answer text', async () => {
    mockSupervisor.plan.mockResolvedValue({ action: 'respond' });

    const result = await resolve();

    expect(result.content).toBe('Xin lỗi, mình chưa có câu trả lời phù hợp.');
  });

  it('calls plan() exactly ONCE and executes the single planned step, using the result directly (stream = save) once evaluate() says "done"', async () => {
    mockSupervisor.plan.mockResolvedValue({
      action: 'plan',
      steps: [{ agent: 'sql_server', task: 'liệt kê bảng' }],
    });
    mockReactLoop.run.mockResolvedValue({
      answer: 'Có 2 bảng.',
      toolCalls: [{ tool: 'get_database_schema', status: 'success' }],
    });

    const result = await resolve();

    expect(mockSupervisor.plan).toHaveBeenCalledTimes(1);
    expect(mockReactLoop.run).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: 'liệt kê bảng',
        provider: 'sql_server',
        userId: data.userId,
        messageId: replyMessageId,
        history: [],
      }),
      expect.anything(),
      expect.anything(),
    );
    expect(mockSupervisor.evaluate).toHaveBeenCalledWith(
      'có bao nhiêu bảng?',
      { agent: 'sql_server', task: 'liệt kê bảng', result: 'Có 2 bảng.' },
      [],
      expect.any(Object),
    );
    expect(result).toEqual({
      content: 'Có 2 bảng.',
      toolCalls: [{ tool: 'get_database_schema', status: 'success' }],
    });
  });

  it('falls back to the original user prompt when a step has no "task" text of its own', async () => {
    mockSupervisor.plan.mockResolvedValue({
      action: 'plan',
      steps: [{ agent: 'sql_server', task: '' }],
    });
    mockReactLoop.run.mockResolvedValue({ answer: 'ok', toolCalls: [] });

    await resolve();

    expect(mockReactLoop.run).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: 'có bao nhiêu bảng?' }),
      expect.anything(),
      expect.anything(),
    );
  });

  it('maps an agent label back to its provider ID when the LLM hallucinates the label instead of the ID (e.g., Dynamic Providers)', async () => {
    const agentsWithDynamic = [
      { provider: 'sql_server', label: 'SQL Server', description: 'desc' },
      { provider: 'dynamic_12345', label: 'Themoviedb', description: 'desc' },
    ];
    mockSupervisor.getAvailableAgents.mockResolvedValue(agentsWithDynamic);
    mockSupervisor.plan.mockResolvedValue({
      action: 'plan',
      // LLM returns the label 'Themoviedb' instead of the uuid
      steps: [{ agent: 'Themoviedb', task: 'tìm phim' }],
    });
    mockReactLoop.run.mockResolvedValue({ answer: 'ok', toolCalls: [] });

    await resolve();

    expect(mockReactLoop.run).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'dynamic_12345' }),
      expect.anything(),
      expect.anything(),
    );
  });

  it('falls back to a safe message and skips ReactLoopService when Supervisor plans a step for an agent outside the available list', async () => {
    // "notion" không có trong availableAgents
    mockSupervisor.plan.mockResolvedValue({
      action: 'plan',
      steps: [{ agent: 'notion', task: 'đọc trang' }],
    });

    const result = await resolve();

    expect(mockReactLoop.run).not.toHaveBeenCalled();
    expect(result.content).toContain('Settings');
  });

  it('treats a missing "steps" field on action="plan" the same as an empty array, instead of throwing', async () => {
    mockSupervisor.plan.mockResolvedValue({ action: 'plan' });

    const result = await resolve();

    expect(mockReactLoop.run).not.toHaveBeenCalled();
    expect(result.content).toContain('Settings');
  });

  it('executes a multi-step plan from a SINGLE plan() call — no re-plan needed between steps that were already known upfront', async () => {
    const twoAgents = [
      { provider: 'sql_server', label: 'SQL Server', description: 'desc' },
      { provider: 'github', label: 'GitHub', description: 'desc' },
    ];
    mockSupervisor.getAvailableAgents.mockResolvedValue(twoAgents);
    mockSupervisor.plan.mockResolvedValue({
      action: 'plan',
      steps: [
        { agent: 'sql_server', task: 'tìm khách chi tiêu nhiều nhất' },
        { agent: 'github', task: 'tạo issue nhắc follow-up' },
      ],
    });
    mockReactLoop.run
      .mockResolvedValueOnce({
        answer: 'Khách chi tiêu nhiều nhất: Nguyễn Văn A, 5.000.000đ',
        toolCalls: [
          { tool: 'sql_server.execute_read_only_query', status: 'success' },
        ],
      })
      .mockResolvedValueOnce({
        answer: 'Đã tạo issue #12',
        toolCalls: [{ tool: 'github.create_issue', status: 'success' }],
      });
    mockSupervisor.evaluate
      .mockResolvedValueOnce({ verdict: 'continue' }) // sau bước 1
      .mockResolvedValueOnce({ verdict: 'done' }); // sau bước 2
    mockSupervisor.synthesize.mockResolvedValue(
      'Đã tìm khách VIP và tạo issue GitHub nhắc follow-up.',
    );

    const result = await resolve();

    // CHỈ 1 lần plan() — cả 2 bước đã có sẵn từ đầu, không cần hỏi lại model
    // "giờ làm gì tiếp" giữa chừng như decide() cũ.
    expect(mockSupervisor.plan).toHaveBeenCalledTimes(1);
    expect(mockReactLoop.run).toHaveBeenCalledTimes(2);
    // Chạy TUẦN TỰ (không fan-out song song) — streamKey khác round (r0, r1),
    // không phải cùng round như cơ chế fan-out cũ đã bỏ.
    expect(mockReactLoop.run).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        provider: 'sql_server',
        streamKey: 'r0-sql_server',
      }),
      expect.anything(),
      expect.anything(),
    );
    expect(mockReactLoop.run).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ provider: 'github', streamKey: 'r1-github' }),
      expect.anything(),
      expect.anything(),
    );
    expect(mockSupervisor.synthesize).toHaveBeenCalledWith(
      'có bao nhiêu bảng?',
      [
        {
          agent: 'sql_server',
          task: 'tìm khách chi tiêu nhiều nhất',
          result: 'Khách chi tiêu nhiều nhất: Nguyễn Văn A, 5.000.000đ',
        },
        {
          agent: 'github',
          task: 'tạo issue nhắc follow-up',
          result: 'Đã tạo issue #12',
        },
      ],
      expect.any(Function),
      expect.anything(),
    );
    expect(result.content).toBe(
      'Đã tìm khách VIP và tạo issue GitHub nhắc follow-up.',
    );
    expect(result.toolCalls).toEqual([
      { tool: 'sql_server.execute_read_only_query', status: 'success' },
      { tool: 'github.create_issue', status: 'success' },
    ]);
  });

  it('re-plans (calls plan() again) when evaluate() returns "re-plan", feeding the completed step back in as context', async () => {
    const twoAgents = [
      { provider: 'sql_server', label: 'SQL Server', description: 'desc' },
      { provider: 'github', label: 'GitHub', description: 'desc' },
    ];
    mockSupervisor.getAvailableAgents.mockResolvedValue(twoAgents);
    mockSupervisor.plan
      .mockResolvedValueOnce({
        action: 'plan',
        steps: [{ agent: 'sql_server', task: 'tìm bảng có cột Email' }],
      })
      .mockResolvedValueOnce({
        action: 'plan',
        steps: [{ agent: 'github', task: 'tạo issue nhắc follow-up' }],
      });
    mockReactLoop.run
      .mockResolvedValueOnce({
        answer: 'Bảng Users có cột Email',
        toolCalls: [{ tool: 'get_database_schema', status: 'success' }],
      })
      .mockResolvedValueOnce({ answer: 'Đã tạo issue #12', toolCalls: [] });
    mockSupervisor.evaluate
      .mockResolvedValueOnce({ verdict: 'replan' })
      .mockResolvedValueOnce({ verdict: 'done' });
    mockSupervisor.synthesize.mockResolvedValue('Đã xong cả 2 việc.');

    await resolve();

    expect(mockSupervisor.plan).toHaveBeenCalledTimes(2);
    // `rounds` là mảng mutable, tiếp tục bị push sau lượt gọi này (bước 2 tự
    // thêm round của chính nó) — so sánh phần tử ĐẦU (đã có tại thời điểm gọi
    // lần 2) thay vì nguyên mảng lúc assert (đã có thêm round 2 trong đó).
    const secondPlanArgs = mockSupervisor.plan.mock.calls[1];
    expect(secondPlanArgs[0]).toBe('có bao nhiêu bảng?');
    expect(secondPlanArgs[1]).toEqual(twoAgents);
    expect((secondPlanArgs[2] as unknown[])[0]).toEqual({
      agent: 'sql_server',
      task: 'tìm bảng có cột Email',
      result: 'Bảng Users có cột Email',
    });
    // Bug thật phát hiện qua review — bước "github" (sau re-plan) phải thấy dữ
    // liệu thật của bước sql_server, nhưng KHÔNG được thấy nguyên văn ghi chú
    // nội bộ REPLAN_MARKER (chỉ Supervisor cần biết "vừa re-plan", không phải
    // sub-agent đang thực thi bước tiếp theo).
    const githubCallPrompt = mockReactLoop.run.mock.calls[1][0].prompt;
    expect(githubCallPrompt).toContain('Bảng Users có cột Email');
    expect(githubCallPrompt).not.toContain('[re-plan]');
  });

  // accuracy_problem.md mục 6 (bổ sung) — lưới an toàn rule-based: evaluate()
  // là LLM, hướng dẫn prompt không tự nó ĐẢM BẢO model tuân theo 100%. Test
  // này mô phỏng ĐÚNG kịch bản bug thật đã gặp (petstore→sql_server): model
  // trả "done" ngay sau bước LẤY dữ liệu, dù bước CHÈN dữ liệu (đã có sẵn
  // trong kế hoạch từ plan() ban đầu) vẫn còn chưa chạy.
  it('accuracy_problem.md mục 6 — KHÔNG bỏ dở bước HÀNH ĐỘNG còn lại khi evaluate() trả "done" quá sớm (rule-based safety net, không chỉ dựa vào prompt)', async () => {
    const twoAgents = [
      { provider: 'petstore', label: 'Petstore', description: 'desc' },
      { provider: 'sql_server', label: 'SQL Server', description: 'desc' },
    ];
    mockSupervisor.getAvailableAgents.mockResolvedValue(twoAgents);
    mockSupervisor.plan.mockResolvedValue({
      action: 'plan',
      steps: [
        { agent: 'petstore', task: 'lấy danh sách pet từ petstore' },
        { agent: 'sql_server', task: 'chèn danh sách pet vào bảng pet' },
      ],
    });
    mockReactLoop.run
      .mockResolvedValueOnce({
        answer: 'Đã lấy 500 con pet từ petstore',
        toolCalls: [{ tool: 'petstore.findPetsByStatus', status: 'success' }],
      })
      .mockResolvedValueOnce({
        answer: 'Đã chèn 500 dòng vào bảng pet',
        toolCalls: [
          { tool: 'sql_server.execute_write_query', status: 'success' },
        ],
      });
    // Bug thật: evaluate() sai lầm trả "done" NGAY SAU bước lấy dữ liệu, dù
    // bước "chèn" vẫn còn nguyên trong `steps` — chưa hề chạy.
    mockSupervisor.evaluate.mockResolvedValueOnce({ verdict: 'done' });
    mockSupervisor.synthesize.mockResolvedValue(
      'Đã lấy dữ liệu và chèn vào bảng pet.',
    );

    const result = await resolve();

    // Bước "chèn" PHẢI được thực thi — không bị bỏ dở giữa chừng.
    expect(mockReactLoop.run).toHaveBeenCalledTimes(2);
    expect(mockReactLoop.run).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        provider: 'sql_server',
        prompt: expect.stringContaining('chèn danh sách pet vào bảng pet'),
      }),
      expect.anything(),
      expect.anything(),
    );
    expect(result.toolCalls).toEqual([
      { tool: 'petstore.findPetsByStatus', status: 'success' },
      { tool: 'sql_server.execute_write_query', status: 'success' },
    ]);
  });

  it('accuracy_problem.md mục 6 — VẪN tôn trọng "done" như bình thường khi KHÔNG còn bước hành động nào bị bỏ dở (không phải lúc nào cũng ép continue)', async () => {
    mockSupervisor.plan.mockResolvedValue({
      action: 'plan',
      steps: [{ agent: 'sql_server', task: 'liệt kê danh sách bảng hiện có' }],
    });
    mockReactLoop.run.mockResolvedValue({
      answer: 'Có 2 bảng: users, orders',
      toolCalls: [{ tool: 'get_database_schema', status: 'success' }],
    });
    mockSupervisor.evaluate.mockResolvedValueOnce({ verdict: 'done' });

    const result = await resolve();

    // Đúng 1 bước, không có bước nào khác bị bỏ dở — "done" hợp lệ, không cần
    // ép continue, không cần gọi lại plan()/reactLoop.run() thêm lần nào.
    expect(mockReactLoop.run).toHaveBeenCalledTimes(1);
    expect(mockSupervisor.plan).toHaveBeenCalledTimes(1);
    expect(result.content).toBe('Có 2 bảng: users, orders');
  });

  // accuracy_problem.md mục 11 — bug thật gặp qua sử dụng: user hỏi "danh
  // sách tên X có khớp bảng Customers không" — plan() tách thành (1) lấy dữ
  // liệu, (2) kiểm tra/so sánh — nhưng evaluate() trả "done" ngay sau bước
  // (1), bỏ qua hẳn bước (2) (bước THẬT SỰ đưa ra kết luận). Task của bước
  // (2) không chứa từ khoá HÀNH ĐỘNG GHI nào (ACTION_TASK_KEYWORDS) nên lưới
  // an toàn mục 6 (bản gốc) không bắt được — cần VERIFICATION_TASK_KEYWORDS.
  it('accuracy_problem.md mục 11 — KHÔNG bỏ dở bước KIỂM TRA/SO SÁNH còn lại khi evaluate() trả "done" quá sớm', async () => {
    mockSupervisor.plan.mockResolvedValue({
      action: 'plan',
      steps: [
        { agent: 'sql_server', task: 'lấy tất cả dữ liệu từ bảng Customers' },
        {
          agent: 'sql_server',
          task: 'kiểm tra xem có các record nào có name thuộc danh sách {A, B, C} trong bảng Customers',
        },
      ],
    });
    mockReactLoop.run
      .mockResolvedValueOnce({
        answer: 'Đã lấy toàn bộ 51 dòng từ bảng Customers',
        toolCalls: [
          { tool: 'sql_server.execute_read_only_query', status: 'success' },
        ],
      })
      .mockResolvedValueOnce({
        answer: 'Khớp: A, B — không tìm thấy: C',
        toolCalls: [
          { tool: 'sql_server.execute_read_only_query', status: 'success' },
        ],
      });
    // Bug thật: evaluate() sai lầm trả "done" NGAY SAU bước lấy dữ liệu, dù
    // bước "kiểm tra" vẫn còn nguyên trong `steps` — chưa hề chạy.
    mockSupervisor.evaluate.mockResolvedValueOnce({ verdict: 'done' });
    mockSupervisor.synthesize.mockResolvedValue(
      'Khớp: A, B — không tìm thấy: C',
    );

    const result = await resolve();

    // Bước "kiểm tra" PHẢI được thực thi — không bị bỏ dở giữa chừng.
    expect(mockReactLoop.run).toHaveBeenCalledTimes(2);
    expect(mockReactLoop.run).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        provider: 'sql_server',
        prompt: expect.stringContaining('kiểm tra xem có các record nào'),
      }),
      expect.anything(),
      expect.anything(),
    );
    expect(result.content).toBe('Khớp: A, B — không tìm thấy: C');
  });

  // accuracy_problem.md mục 12 — ACTION_TASK_KEYWORDS/VERIFICATION_TASK_KEYWORDS
  // (mục 6/11) chỉ match từ khoá tiếng Việt/Anh trong `task` — user hỏi bằng
  // ngôn ngữ THỨ 3 (VD tiếng Pháp) khiến plan() có thể sinh `task` bằng ngôn
  // ngữ đó, không khớp từ khoá nào, lưới an toàn cũ im re. Fix: field
  // "mustExecute" (boolean cố định, model tự phán đoán NGỮ NGHĨA — không phải
  // match chuỗi) đi kèm mỗi step, độc lập hoàn toàn với ngôn ngữ của `task`.
  it('accuracy_problem.md mục 12 — KHÔNG bỏ dở bước KIỂM TRA dù `task` viết bằng ngôn ngữ KHÁC (không phải tiếng Việt/Anh), nhờ "mustExecute" thay vì từ khoá', async () => {
    mockSupervisor.plan.mockResolvedValue({
      action: 'plan',
      steps: [
        {
          agent: 'sql_server',
          task: 'obtenir toutes les données de la table Customers',
          mustExecute: false,
        },
        {
          agent: 'sql_server',
          task: 'vérifier si les enregistrements correspondent à la liste {A, B, C}',
          mustExecute: true,
        },
      ],
    });
    mockReactLoop.run
      .mockResolvedValueOnce({
        answer: '51 lignes récupérées',
        toolCalls: [
          { tool: 'sql_server.execute_read_only_query', status: 'success' },
        ],
      })
      .mockResolvedValueOnce({
        answer: 'Correspond: A, B — introuvable: C',
        toolCalls: [
          { tool: 'sql_server.execute_read_only_query', status: 'success' },
        ],
      });
    // Bug (nếu chỉ dựa từ khoá): evaluate() trả "done" ngay sau bước "read",
    // và `task` bước "verify" không chứa bất kỳ từ khoá tiếng Việt/Anh nào
    // trong ACTION_TASK_KEYWORDS/VERIFICATION_TASK_KEYWORDS.
    mockSupervisor.evaluate.mockResolvedValueOnce({ verdict: 'done' });
    mockSupervisor.synthesize.mockResolvedValue(
      'Correspond: A, B — introuvable: C',
    );

    const result = await resolve();

    expect(mockReactLoop.run).toHaveBeenCalledTimes(2);
    expect(mockReactLoop.run).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        provider: 'sql_server',
        prompt: expect.stringContaining('vérifier si les enregistrements'),
      }),
      expect.anything(),
      expect.anything(),
    );
    expect(result.content).toBe('Correspond: A, B — introuvable: C');
  });

  // accuracy_problem.md mục 12 (tiếp) — lý do đổi enum 'read'|'write'|'verify'
  // sang boolean "mustExecute": bước TÍNH TOÁN/TỔNG HỢP dựa trên dữ liệu đã lấy
  // (không ghi vào đâu, không phải so sánh đúng/sai) không thuộc rõ loại nào
  // trong 3 loại cũ — dùng enum, model dễ gán nhầm "read" (vì không "ghi" đi
  // đâu) khiến lưới an toàn bỏ sót. Boolean hỏi thẳng đúng câu cần biết ("bỏ
  // qua được không") nên không bị giới hạn bởi 1 danh sách loại hành động.
  it('accuracy_problem.md mục 12 — KHÔNG bỏ dở bước TÍNH TOÁN/TỔNG HỢP (không phải write, không phải verify — loại mà enum cũ bỏ sót)', async () => {
    mockSupervisor.plan.mockResolvedValue({
      action: 'plan',
      steps: [
        {
          agent: 'sql_server',
          task: 'lấy toàn bộ đơn hàng quý này từ bảng Orders',
          mustExecute: false,
        },
        {
          agent: 'sql_server',
          task: 'tính tổng doanh số từ danh sách đơn hàng vừa lấy',
          mustExecute: true,
        },
      ],
    });
    mockReactLoop.run
      .mockResolvedValueOnce({
        answer: 'Đã lấy 320 đơn hàng',
        toolCalls: [
          { tool: 'sql_server.execute_read_only_query', status: 'success' },
        ],
      })
      .mockResolvedValueOnce({
        answer: 'Tổng doanh số quý này: 1.250.000.000đ',
        toolCalls: [
          { tool: 'sql_server.execute_read_only_query', status: 'success' },
        ],
      });
    // Bug (nếu chỉ dựa từ khoá cũ hoặc enum read/write/verify): bước "tính
    // tổng" không chứa từ khoá GHI/KIỂM TRA nào, và không phải write/verify —
    // evaluate() trả "done" ngay sau bước lấy dữ liệu thô sẽ bị bỏ lọt.
    mockSupervisor.evaluate.mockResolvedValueOnce({ verdict: 'done' });
    mockSupervisor.synthesize.mockResolvedValue(
      'Tổng doanh số quý này: 1.250.000.000đ',
    );

    const result = await resolve();

    expect(mockReactLoop.run).toHaveBeenCalledTimes(2);
    expect(mockReactLoop.run).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        provider: 'sql_server',
        prompt: expect.stringContaining('tính tổng doanh số'),
      }),
      expect.anything(),
      expect.anything(),
    );
    expect(result.content).toBe('Tổng doanh số quý này: 1.250.000.000đ');
  });

  // accuracy_problem.md mục 13 — COMPUTE_TASK_KEYWORDS: lớp phòng thủ MIỄN PHÍ
  // (OR vô điều kiện, không tốn gì thêm) cho ĐÚNG trường hợp model LỠ GÁN SAI
  // mustExecute (phán đoán ngữ nghĩa, không đảm bảo 100%) — mô phỏng model gán
  // "mustExecute: false" NHẦM cho 1 bước tính toán thật ra bắt buộc phải chạy.
  it('accuracy_problem.md mục 13 — COMPUTE_TASK_KEYWORDS cứu được khi model LỠ gán sai "mustExecute: false" cho bước TÍNH TOÁN', async () => {
    mockSupervisor.plan.mockResolvedValue({
      action: 'plan',
      steps: [
        {
          agent: 'sql_server',
          task: 'lấy toàn bộ đơn hàng quý này từ bảng Orders',
          mustExecute: false,
        },
        {
          agent: 'sql_server',
          // Model gán SAI mustExecute:false — vẫn phải bị chặn nhờ từ khoá
          // "tính trung bình" trong COMPUTE_TASK_KEYWORDS.
          task: 'tính trung bình giá trị đơn hàng từ danh sách vừa lấy',
          mustExecute: false,
        },
      ],
    });
    mockReactLoop.run
      .mockResolvedValueOnce({
        answer: 'Đã lấy 320 đơn hàng',
        toolCalls: [
          { tool: 'sql_server.execute_read_only_query', status: 'success' },
        ],
      })
      .mockResolvedValueOnce({
        answer: 'Trung bình đơn hàng: 3.906.250đ',
        toolCalls: [
          { tool: 'sql_server.execute_read_only_query', status: 'success' },
        ],
      });
    mockSupervisor.evaluate.mockResolvedValueOnce({ verdict: 'done' });
    mockSupervisor.synthesize.mockResolvedValue(
      'Trung bình đơn hàng: 3.906.250đ',
    );

    const result = await resolve();

    expect(mockReactLoop.run).toHaveBeenCalledTimes(2);
    expect(mockReactLoop.run).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        provider: 'sql_server',
        prompt: expect.stringContaining('tính trung bình giá trị đơn hàng'),
      }),
      expect.anything(),
      expect.anything(),
    );
    expect(result.content).toBe('Trung bình đơn hàng: 3.906.250đ');
  });

  describe('trace UI — step_start events (FE hiện trace theo từng bước, giống Claude Code)', () => {
    it('emits a step_start event with a human-readable label BEFORE reactLoop.run(), on the SAME streamKey', async () => {
      mockSupervisor.plan.mockResolvedValue({
        action: 'plan',
        steps: [{ agent: 'sql_server', task: 'liệt kê bảng' }],
      });
      mockReactLoop.run.mockResolvedValue({
        answer: 'Có 2 bảng.',
        toolCalls: [],
      });

      await resolve();

      const stepStartCall = mockAgentStream.emitStep.mock.calls.find(
        ([, step]) => step.type === 'step_start',
      );
      expect(stepStartCall).toBeDefined();
      const [context, step] = stepStartCall!;
      expect(context).toEqual(
        expect.objectContaining({ streamKey: 'r0-sql_server' }),
      );
      expect(step).toEqual({
        type: 'step_start',
        label: 'SQL Server: liệt kê bảng',
      });
      // Phát TRƯỚC reactLoop.run(), không phải sau — FE cần nhãn TRƯỚC khi
      // tool_call/token đầu tiên của bước đó tới.
      const stepStartOrder =
        mockAgentStream.emitStep.mock.invocationCallOrder[
          mockAgentStream.emitStep.mock.calls.indexOf(stepStartCall!)
        ];
      expect(stepStartOrder).toBeLessThan(
        mockReactLoop.run.mock.invocationCallOrder[0],
      );
    });

    it('emits a step_start with kind="synthesize" before synthesize() when a multi-round answer needs tổng hợp', async () => {
      const twoAgents = [
        { provider: 'sql_server', label: 'SQL Server', description: 'desc' },
        { provider: 'github', label: 'GitHub', description: 'desc' },
      ];
      mockSupervisor.getAvailableAgents.mockResolvedValue(twoAgents);
      mockSupervisor.plan.mockResolvedValue({
        action: 'plan',
        steps: [
          { agent: 'sql_server', task: 'lấy danh sách khách VIP' },
          { agent: 'github', task: 'tạo issue nhắc follow-up' },
        ],
      });
      mockReactLoop.run
        .mockResolvedValueOnce({ answer: 'Có 3 khách VIP', toolCalls: [] })
        .mockResolvedValueOnce({ answer: 'Đã tạo issue #42', toolCalls: [] });
      mockSupervisor.evaluate
        .mockResolvedValueOnce({ verdict: 'continue' })
        .mockResolvedValueOnce({ verdict: 'done' });
      mockSupervisor.synthesize.mockResolvedValue('Đã xong cả 2 việc.');

      await resolve();

      const synthesizeStepStart = mockAgentStream.emitStep.mock.calls.find(
        ([, step]) => step.type === 'step_start' && step.kind === 'synthesize',
      );
      expect(synthesizeStepStart).toBeDefined();
      expect(synthesizeStepStart![1]).toEqual({
        type: 'step_start',
        label: 'Tổng hợp câu trả lời',
        kind: 'synthesize',
      });
      // Phát TRƯỚC lệnh gọi synthesize() thật.
      const synthesizeStepStartOrder =
        mockAgentStream.emitStep.mock.invocationCallOrder[
          mockAgentStream.emitStep.mock.calls.indexOf(synthesizeStepStart!)
        ];
      expect(synthesizeStepStartOrder).toBeLessThan(
        mockSupervisor.synthesize.mock.invocationCallOrder[0],
      );
    });
  });

  describe('mục 3 (accuracy.v2.md) — planning-stage guardrail (chặn TRƯỚC khi thực thi 1 lựa chọn agent rành rành sai)', () => {
    const twoAgents = [
      { provider: 'sql_server', label: 'SQL Server', description: 'desc' },
      { provider: 'google_docs', label: 'Google Docs', description: 'desc' },
    ];

    beforeEach(() => {
      mockSupervisor.getAvailableAgents.mockResolvedValue(twoAgents);
    });

    it('blocks execution and re-plans early (no reactLoop.run()) when the task clearly names a DIFFERENT connected agent than the one chosen', async () => {
      mockSupervisor.plan
        .mockResolvedValueOnce({
          action: 'plan',
          steps: [
            { agent: 'sql_server', task: 'lưu nội dung này vào Google Docs' },
          ],
        })
        .mockResolvedValueOnce({
          action: 'plan',
          steps: [
            {
              agent: 'google_docs',
              task: 'lưu nội dung này vào Google Docs',
            },
          ],
        });
      mockReactLoop.run.mockResolvedValue({ answer: 'Đã lưu.', toolCalls: [] });
      mockSupervisor.evaluate.mockResolvedValue({ verdict: 'done' });
      // rounds giờ có 2 phần tử (note bị guardrail chặn + kết quả thật) — đánh
      // đổi đã biết (xem comment ở continueRounds()): finalizeAnswer() thấy
      // rounds.length > 1 nên tổng hợp qua synthesize() thay vì trả thẳng
      // rounds[0].result.
      mockSupervisor.synthesize.mockResolvedValue(
        'Đã lưu nội dung vào Google Docs.',
      );

      const result = await resolve();

      expect(mockSupervisor.plan).toHaveBeenCalledTimes(2);
      expect(mockReactLoop.run).toHaveBeenCalledTimes(1);
      expect(mockReactLoop.run).toHaveBeenCalledWith(
        expect.objectContaining({ provider: 'google_docs' }),
        expect.anything(),
        expect.anything(),
      );
      expect(mockSupervisor.synthesize).toHaveBeenCalledTimes(1);
      expect(result.content).toBe('Đã lưu nội dung vào Google Docs.');
    });

    it('bug thật phát hiện qua review — KHÔNG rò rỉ ghi chú nội bộ GUARDRAIL_BLOCKED_MARKER vào prompt của sub-agent thực thi bước sau (chỉ Supervisor cần biết chuyện "vừa bị chặn", sub-agent không cần và không nên thấy)', async () => {
      mockSupervisor.plan
        .mockResolvedValueOnce({
          action: 'plan',
          steps: [
            { agent: 'sql_server', task: 'lưu nội dung này vào Google Docs' },
          ],
        })
        .mockResolvedValueOnce({
          action: 'plan',
          steps: [
            {
              agent: 'google_docs',
              task: 'lưu nội dung này vào Google Docs',
            },
            {
              agent: 'sql_server',
              task: 'ghi log kết quả vào bảng logs',
            },
          ],
        });
      mockReactLoop.run
        .mockResolvedValueOnce({ answer: 'Đã lưu.', toolCalls: [] })
        .mockResolvedValueOnce({ answer: 'Đã ghi log.', toolCalls: [] });
      mockSupervisor.evaluate
        .mockResolvedValueOnce({ verdict: 'continue' })
        .mockResolvedValueOnce({ verdict: 'done' });

      await resolve();

      // Bước 2 (ghi log) chạy SAU bước bị guardrail chặn + bước "lưu Google
      // Docs" — prompt của nó PHẢI có dữ liệu thật của bước "lưu Google Docs",
      // nhưng TUYỆT ĐỐI không được chứa nguyên văn ghi chú nội bộ của guardrail.
      expect(mockReactLoop.run).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          provider: 'sql_server',
          prompt: expect.stringContaining('Đã lưu.'),
        }),
        expect.anything(),
        expect.anything(),
      );
      const secondCallPrompt = mockReactLoop.run.mock.calls[1][0].prompt;
      expect(secondCallPrompt).not.toContain('Bỏ qua bước này');
    });

    it('does NOT block a correct choice whose task text simply shares no keywords with the agent description — avoids the false-positive a naive keyword-overlap check would cause', async () => {
      mockSupervisor.plan.mockResolvedValue({
        action: 'plan',
        steps: [
          {
            agent: 'sql_server',
            task: 'chèn thông tin diễn viên vào bảng users',
          },
        ],
      });
      mockReactLoop.run.mockResolvedValue({
        answer: 'Đã chèn.',
        toolCalls: [],
      });
      mockSupervisor.evaluate.mockResolvedValue({ verdict: 'done' });

      const result = await resolve();

      expect(mockSupervisor.plan).toHaveBeenCalledTimes(1);
      expect(mockReactLoop.run).toHaveBeenCalledTimes(1);
      expect(result.content).toBe('Đã chèn.');
    });

    it('does not block when the task mentions the chosen agent by name even if it ALSO mentions a different connected agent', async () => {
      mockSupervisor.plan.mockResolvedValue({
        action: 'plan',
        steps: [
          {
            agent: 'sql_server',
            task: 'Lấy dữ liệu đã có từ Google Docs rồi ghi vào SQL Server',
          },
        ],
      });
      mockReactLoop.run.mockResolvedValue({ answer: 'Đã ghi.', toolCalls: [] });
      mockSupervisor.evaluate.mockResolvedValue({ verdict: 'done' });

      await resolve();

      expect(mockSupervisor.plan).toHaveBeenCalledTimes(1);
      expect(mockReactLoop.run).toHaveBeenCalledTimes(1);
    });

    it('ignores very short agent labels when checking for a mismatch, to avoid spurious matches against generic short names', async () => {
      mockSupervisor.getAvailableAgents.mockResolvedValue([
        ...twoAgents,
        { provider: 'short_agent', label: 'Go', description: 'desc' },
      ]);
      mockSupervisor.plan.mockResolvedValue({
        action: 'plan',
        // Câu task tình cờ chứa "go" như 1 phần của từ khác — KHÔNG nên bị
        // coi là "nhắc tới agent short_agent" (nhãn "Go" quá ngắn, dưới
        // MIN_AGENT_LABEL_LENGTH_FOR_MISMATCH_CHECK).
        steps: [
          {
            agent: 'sql_server',
            task: 'go xem thử báo cáo doanh thu tháng này',
          },
        ],
      });
      mockReactLoop.run.mockResolvedValue({ answer: 'ok', toolCalls: [] });
      mockSupervisor.evaluate.mockResolvedValue({ verdict: 'done' });

      await resolve();

      expect(mockSupervisor.plan).toHaveBeenCalledTimes(1);
      expect(mockReactLoop.run).toHaveBeenCalledTimes(1);
    });

    it('stays within MAX_SUPERVISOR_ROUNDS even if plan() keeps proposing a misrouted step every time — bounded, not an infinite loop', async () => {
      mockSupervisor.plan.mockImplementation(() =>
        Promise.resolve({
          action: 'plan',
          steps: [
            { agent: 'sql_server', task: 'lưu nội dung này vào Google Docs' },
          ],
        }),
      );
      mockSupervisor.synthesize.mockResolvedValue(
        'Không xác định được hệ thống phù hợp.',
      );

      const result = await resolve();

      expect(mockReactLoop.run).not.toHaveBeenCalled();
      expect(mockSupervisor.plan).toHaveBeenCalledTimes(
        ORCHESTRATION_CONSTANTS.MAX_SUPERVISOR_ROUNDS,
      );
      expect(mockSupervisor.synthesize).toHaveBeenCalledTimes(1);
      expect(result.content).toBe('Không xác định được hệ thống phù hợp.');
    });
  });

  it('stops after MAX_SUPERVISOR_ROUNDS and asks Supervisor to synthesize all collected rounds instead of returning the raw last step (Step 9)', async () => {
    // mockImplementation (không phải mockResolvedValue) — trả về 1 mảng MỚI
    // mỗi lần gọi. continueRounds() dùng steps.shift() (mutate tại chỗ); nếu
    // dùng chung 1 object literal cho mọi lần gọi, lần gọi đầu sẽ "rút cạn"
    // mảng đó, khiến các lần gọi sau nhận về steps rỗng — không phản ánh đúng
    // hành vi thật (mỗi lần plan() LLM trả về 1 kế hoạch MỚI, độc lập).
    mockSupervisor.plan.mockImplementation(() =>
      Promise.resolve({
        action: 'plan',
        steps: [{ agent: 'sql_server', task: 'tiếp tục' }],
      }),
    );
    let call = 0;
    mockReactLoop.run.mockImplementation(() =>
      Promise.resolve({ answer: `kết quả bước ${++call}`, toolCalls: [] }),
    );
    // Luôn re-plan — mô phỏng 1 kế hoạch không bao giờ hội tụ tự nhiên.
    mockSupervisor.evaluate.mockResolvedValue({ verdict: 'replan' });
    mockSupervisor.synthesize.mockResolvedValue(
      'Tổng hợp toàn bộ các bước đã thu thập được.',
    );

    const result = await resolve();

    // Mỗi vòng re-plan tốn ĐÚNG 1 "vé" nonProgressRounds (accuracy_problem.md)
    // -> dừng sau đúng MAX_SUPERVISOR_ROUNDS bước thật, dù realStepsRun còn dư
    // rất nhiều (MAX_REAL_STEPS_PER_TURN cao hơn hẳn).
    expect(mockReactLoop.run).toHaveBeenCalledTimes(
      ORCHESTRATION_CONSTANTS.MAX_SUPERVISOR_ROUNDS,
    );
    expect(mockSupervisor.synthesize).toHaveBeenCalledTimes(1);
    const [synthesizePrompt, synthesizeRounds] =
      mockSupervisor.synthesize.mock.calls[0];
    expect(synthesizePrompt).toBe('có bao nhiêu bảng?');
    // Mỗi vòng re-plan đẩy THÊM 1 round thật ('kết quả bước N') VÀ 1 marker
    // '[re-plan]...' (để sống sót qua resume, xem TurnResolverService) -> gấp
    // đôi số lượng so với chỉ đếm bước thật.
    expect(synthesizeRounds).toHaveLength(
      ORCHESTRATION_CONSTANTS.MAX_SUPERVISOR_ROUNDS * 2,
    );
    expect(
      synthesizeRounds.filter((r: { result: string }) =>
        r.result.startsWith('kết quả bước'),
      ),
    ).toHaveLength(ORCHESTRATION_CONSTANTS.MAX_SUPERVISOR_ROUNDS);
    expect(result.content).toBe('Tổng hợp toàn bộ các bước đã thu thập được.');
  });

  it('rejects with TurnCancelledError, carrying the last completed step result, when Stop is requested between steps', async () => {
    mockSupervisor.plan.mockResolvedValue({
      action: 'plan',
      steps: [{ agent: 'sql_server', task: 'liệt kê bảng' }],
    });
    mockReactLoop.run.mockResolvedValue({ answer: 'Có 2 bảng', toolCalls: [] });
    mockCancellation.isCancelled
      .mockResolvedValueOnce(false) // trước khi plan() lần đầu
      .mockResolvedValueOnce(true); // Stop được bấm giữa chừng, trước bước kế
    mockSupervisor.evaluate.mockResolvedValue({ verdict: 'replan' });

    await expect(resolve()).rejects.toThrow(TurnCancelledError);
  });

  it('bug fix — khi Stop giữa 1 turn NHIỀU round, partialText giữ ĐỦ các round đã xong, không chỉ round CUỐI (trace tool-call vẫn hiện đủ, nhưng câu trả lời lưu lại từng "thiếu" round đầu)', async () => {
    mockSupervisor.plan.mockResolvedValue({
      action: 'plan',
      steps: [
        { agent: 'sql_server', task: 'liệt kê bảng' },
        { agent: 'sql_server', task: 'liệt kê view' },
      ],
    });
    mockReactLoop.run
      .mockResolvedValueOnce({
        answer: 'Có 2 bảng: Orders, Products',
        toolCalls: [],
      })
      .mockResolvedValueOnce({ answer: 'Đã tạo trang ghi chú', toolCalls: [] });
    mockCancellation.isCancelled
      .mockResolvedValueOnce(false) // trước round 1
      .mockResolvedValueOnce(false) // trước round 2
      .mockResolvedValueOnce(true); // Stop giữa chừng, sau khi CẢ 2 round đã xong
    mockSupervisor.evaluate.mockResolvedValue({ verdict: 'continue' });

    const error = (await resolve().catch((e) => e)) as TurnCancelledError;

    expect(error).toBeInstanceOf(TurnCancelledError);
    expect(error.partialText).toContain('Có 2 bảng: Orders, Products');
    expect(error.partialText).toContain('Đã tạo trang ghi chú');
  });

  it('pauses for approval (via CheckpointPauseService) when a planned step hits the Risk Gate', async () => {
    mockSupervisor.plan.mockResolvedValue({
      action: 'plan',
      steps: [{ agent: 'sql_server', task: 'cập nhật status đơn OrderId=1' }],
    });
    const pendingTool = {
      provider: 'sql_server',
      name: 'execute_write_query',
      args: { query: "UPDATE Orders SET Status='Completed' WHERE OrderId=1" },
    };
    mockReactLoop.run.mockRejectedValue(new ApprovalRequiredError(pendingTool));
    mockCheckpointPause.pauseForApproval.mockResolvedValue({
      content:
        '⏸️ Cần bạn duyệt 1 hành động trước khi tiếp tục — xem tin nhắn bên dưới.',
      toolCalls: undefined,
    });

    const result = await resolve();

    expect(mockCheckpointPause.pauseForApproval).toHaveBeenCalledWith(
      data,
      'có bao nhiêu bảng?',
      [],
      [],
      [],
      {
        approvalRequired: pendingTool,
        task: 'cập nhật status đơn OrderId=1',
        toolCalls: [],
      },
      // accuracy_problem.md mục 9.2 — kế hoạch chỉ có đúng 1 bước (bước vừa bị
      // chặn) — không còn bước nào khác để lưu lại resume.
      [],
    );
    expect(result.content).toContain('Cần bạn duyệt');
  });

  it('accuracy_problem.md mục 9.5 — preserves a safe tool result that ran BEFORE a destructive tool blocked in the SAME LLM turn, as its own round in the checkpoint', async () => {
    mockSupervisor.plan.mockResolvedValue({
      action: 'plan',
      steps: [
        {
          agent: 'sql_server',
          task: 'đọc đơn OrderId=1 rồi huỷ nó',
        },
      ],
    });
    const pendingTool = {
      provider: 'sql_server',
      name: 'execute_write_query',
      args: { query: 'DELETE FROM Orders WHERE OrderId=1' },
    };
    // ReactLoopService cho phép 1 lượt LLM xin gọi NHIỀU tool cùng lúc — tool
    // đọc (an toàn) đã chạy XONG THẬT trước khi tool huỷ (nguy hiểm) bị chặn.
    mockReactLoop.run.mockRejectedValue(
      new ApprovalRequiredError(pendingTool, [
        {
          tool: 'sql_server.execute_read_only_query',
          status: 'success',
          resultPreview: 'Đơn OrderId=1: khách "Alice", tổng tiền 500000đ.',
        },
      ]),
    );
    mockCheckpointPause.pauseForApproval.mockResolvedValue({
      content:
        '⏸️ Cần bạn duyệt 1 hành động trước khi tiếp tục — xem tin nhắn bên dưới.',
      toolCalls: undefined,
    });

    await resolve();

    expect(mockCheckpointPause.pauseForApproval).toHaveBeenCalledWith(
      data,
      'có bao nhiêu bảng?',
      // Round MỚI chứa dữ liệu tool đọc đã chạy xong — KHÔNG bị mất chỉ vì
      // tool huỷ (nguy hiểm) cùng lượt đó bị chặn ngay sau.
      [
        {
          agent: 'sql_server',
          task: 'đọc đơn OrderId=1 rồi huỷ nó (dữ liệu đã thu thập được TRƯỚC KHI cần duyệt 1 hành động khác trong cùng bước này)',
          result:
            'sql_server.execute_read_only_query: Đơn OrderId=1: khách "Alice", tổng tiền 500000đ.',
        },
      ],
      // toolCalls (trace CẢ turn) cũng nhận đúng entry đã thành công đó — kênh
      // hiện UI, độc lập với round vừa thêm ở trên (kênh Supervisor dùng).
      [
        {
          tool: 'sql_server.execute_read_only_query',
          status: 'success',
          resultPreview: 'Đơn OrderId=1: khách "Alice", tổng tiền 500000đ.',
        },
      ],
      [],
      {
        approvalRequired: pendingTool,
        task: 'đọc đơn OrderId=1 rồi huỷ nó',
        toolCalls: [
          {
            tool: 'sql_server.execute_read_only_query',
            status: 'success',
            resultPreview: 'Đơn OrderId=1: khách "Alice", tổng tiền 500000đ.',
          },
        ],
      },
      [],
    );
  });

  it('accuracy_problem.md mục 9.5 — does NOT add a synthetic round when the blocked tool was the FIRST/only one in the turn (nothing to preserve)', async () => {
    mockSupervisor.plan.mockResolvedValue({
      action: 'plan',
      steps: [{ agent: 'sql_server', task: 'cập nhật status đơn OrderId=1' }],
    });
    const pendingTool = {
      provider: 'sql_server',
      name: 'execute_write_query',
      args: { query: "UPDATE Orders SET Status='Completed' WHERE OrderId=1" },
    };
    mockReactLoop.run.mockRejectedValue(new ApprovalRequiredError(pendingTool));
    mockCheckpointPause.pauseForApproval.mockResolvedValue({
      content:
        '⏸️ Cần bạn duyệt 1 hành động trước khi tiếp tục — xem tin nhắn bên dưới.',
      toolCalls: undefined,
    });

    await resolve();

    expect(mockCheckpointPause.pauseForApproval).toHaveBeenCalledWith(
      data,
      'có bao nhiêu bảng?',
      [], // rounds KHÔNG có round nào thêm — không có gì để giữ lại.
      [],
      [],
      {
        approvalRequired: pendingTool,
        task: 'cập nhật status đơn OrderId=1',
        toolCalls: [],
      },
      [],
    );
  });

  it("keeps an earlier step's successful result in the rounds passed to CheckpointPauseService when a LATER sequential step needs approval", async () => {
    const twoAgents = [
      { provider: 'sql_server', label: 'SQL Server', description: 'desc' },
      { provider: 'github', label: 'GitHub', description: 'desc' },
    ];
    mockSupervisor.getAvailableAgents.mockResolvedValue(twoAgents);
    mockSupervisor.plan.mockResolvedValue({
      action: 'plan',
      steps: [
        { agent: 'github', task: 'liệt kê issue' },
        { agent: 'sql_server', task: 'xoá đơn OrderId=1' },
      ],
    });
    const pendingTool = {
      provider: 'sql_server',
      name: 'execute_write_query',
      args: { query: 'DELETE FROM Orders WHERE OrderId=1' },
    };
    mockReactLoop.run
      .mockResolvedValueOnce({
        answer: '3 issue đang mở',
        toolCalls: [{ tool: 'github.list_issues', status: 'success' }],
      })
      .mockRejectedValueOnce(new ApprovalRequiredError(pendingTool));
    mockSupervisor.evaluate.mockResolvedValue({ verdict: 'continue' });
    mockCheckpointPause.pauseForApproval.mockResolvedValue({
      content: 'paused',
      toolCalls: undefined,
    });

    await resolve();

    const roundsArg = mockCheckpointPause.pauseForApproval.mock.calls[0][2];
    expect(roundsArg).toEqual([
      { agent: 'github', task: 'liệt kê issue', result: '3 issue đang mở' },
    ]);
    const toolCallsArg = mockCheckpointPause.pauseForApproval.mock.calls[0][3];
    expect(toolCallsArg).toEqual([
      { tool: 'github.list_issues', status: 'success' },
    ]);
  });

  it('does NOT execute the destructive tool for real (mcpClient.callTool is inside ReactLoop, mocked to reject before ever running it)', async () => {
    mockSupervisor.plan.mockResolvedValue({
      action: 'plan',
      steps: [{ agent: 'sql_server', task: 'xoá đơn OrderId=1' }],
    });
    mockReactLoop.run.mockRejectedValue(
      new ApprovalRequiredError({
        provider: 'sql_server',
        name: 'execute_write_query',
        args: {},
      }),
    );
    mockCheckpointPause.pauseForApproval.mockResolvedValue({
      content: 'paused',
      toolCalls: undefined,
    });

    await resolve();

    // reactLoop.run() được gọi (nó tự chặn tool bên trong trước khi thực thi
    // thật) đúng 1 lần — không có bước nào khác chạy tiếp.
    expect(mockReactLoop.run).toHaveBeenCalledTimes(1);
    expect(mockSupervisor.plan).toHaveBeenCalledTimes(1);
  });

  describe('continueRounds (resume sau khi duyệt 1 hành động — dùng lại bởi ApprovalFlowService)', () => {
    it('feeds the pre-existing round in as context to plan(), instead of starting from an empty history', async () => {
      const existingRounds = [
        {
          agent: 'dynamic_tmdb',
          task: 'lấy danh sách diễn viên',
          result: '[{"name":"A"},{"name":"B"}]',
        },
      ];
      mockSupervisor.plan.mockResolvedValue({
        action: 'plan',
        steps: [{ agent: 'sql_server', task: 'chèn diễn viên vào bảng users' }],
      });
      mockReactLoop.run.mockResolvedValue({
        answer: 'Đã chèn 2 diễn viên vào bảng users.',
        toolCalls: [
          { tool: 'sql_server.execute_write_query', status: 'success' },
        ],
      });

      await service.continueRounds(
        data,
        replyMessageId,
        'lấy diễn viên rồi chèn vào bảng users',
        availableAgents,
        [],
        existingRounds,
        [],
      );

      expect(mockSupervisor.plan).toHaveBeenCalledWith(
        'lấy diễn viên rồi chèn vào bảng users',
        availableAgents,
        existingRounds,
        [],
        // accuracy_problem.md mục 9.4 — continueRounds() tạo 1 cache rỗng mới
        // mỗi lần gọi, truyền xuống plan() để tái dùng ranking agent giữa các
        // lần re-plan trong CÙNG turn.
        {},
        expect.any(Object),
        // ver3.md mục 1 (dài hạn) — channelId truyền cho channel_memory.
        'channel-1',
        'workspace-1',
      );
      // Bước MỚI (sau resume) delegate sang ĐÚNG provider cần thiết cho phần
      // còn lại (sql_server) — KHÔNG bị ép ở lại provider vừa dùng trước đó.
      expect(mockReactLoop.run).toHaveBeenCalledWith(
        expect.objectContaining({ provider: 'sql_server' }),
        expect.anything(),
        expect.anything(),
      );
      // Bug thật (xem accuracy.md bổ sung): agent thực thi bước ghi chỉ thấy
      // đúng câu "task" ngắn gọn, KHÔNG tự nhiên biết dữ liệu THẬT bước trước
      // đã lấy được (VD danh sách diễn viên) — phải ghép NGUYÊN VĂN kết quả đó
      // vào prompt gửi cho ReactLoop, không thì agent chỉ có thể bịa nội dung.
      const sentPrompt = mockReactLoop.run.mock.calls[0][0].prompt;
      expect(sentPrompt).toContain('chèn diễn viên vào bảng users');
      expect(sentPrompt).toContain('lấy danh sách diễn viên');
      expect(sentPrompt).toContain('[{"name":"A"},{"name":"B"}]');
    });

    it('does NOT inject any round context into the prompt when this is the very first step (no rounds yet) — unchanged from before', async () => {
      mockSupervisor.plan.mockResolvedValue({
        action: 'plan',
        steps: [{ agent: 'sql_server', task: 'liệt kê bảng' }],
      });
      mockReactLoop.run.mockResolvedValue({
        answer: 'Có 2 bảng.',
        toolCalls: [],
      });

      await service.continueRounds(
        data,
        replyMessageId,
        'có bao nhiêu bảng?',
        availableAgents,
        [],
        [],
        [],
      );

      expect(mockReactLoop.run).toHaveBeenCalledWith(
        expect.objectContaining({ prompt: 'liệt kê bảng' }),
        expect.anything(),
        expect.anything(),
      );
    });

    it("stores the SHORT original task (not the context-enriched prompt) in the round pushed forward — otherwise each later step would duplicate all prior rounds' data again", async () => {
      const existingRounds = [
        {
          agent: 'dynamic_tmdb',
          task: 'lấy danh sách diễn viên',
          result: '[{"name":"A"},{"name":"B"}]',
        },
      ];
      mockSupervisor.plan.mockResolvedValue({
        action: 'plan',
        steps: [{ agent: 'sql_server', task: 'chèn diễn viên vào bảng users' }],
      });
      mockReactLoop.run.mockResolvedValue({
        answer: 'Đã chèn 2 diễn viên vào bảng users.',
        toolCalls: [],
      });
      mockSupervisor.evaluate.mockResolvedValue({ verdict: 'done' });

      await service.continueRounds(
        data,
        replyMessageId,
        'lấy diễn viên rồi chèn vào bảng users',
        availableAgents,
        [],
        existingRounds,
        [],
      );

      expect(mockSupervisor.evaluate).toHaveBeenCalledWith(
        'lấy diễn viên rồi chèn vào bảng users',
        {
          agent: 'sql_server',
          task: 'chèn diễn viên vào bảng users',
          result: 'Đã chèn 2 diễn viên vào bảng users.',
        },
        [],
        expect.any(Object),
      );
    });

    it('accuracy_problem.md mục 9.2 — restores remainingSteps after an approval instead of re-planning, evaluates the just-approved round first, then runs the correct agent for the leftover step', async () => {
      const agentsWithTmdb = [
        ...availableAgents,
        { provider: 'dynamic_tmdb', label: 'TMDB', description: 'desc' },
      ];
      // Round A (bước vừa được ApprovalFlowService duyệt+chạy TRỰC TIẾP, KHÔNG
      // qua delegateRound()) — nên CHƯA từng đi qua evaluate().
      const existingRounds = [
        {
          agent: 'sql_server',
          task: 'cập nhật status đơn OrderId=1',
          result: 'Đã cập nhật status.',
        },
      ];
      // Bước B còn lại của kế hoạch GỐC — được ApprovalFlowService phục hồi
      // lại từ checkpoint.remainingSteps, KHÔNG phải từ 1 lần plan() mới.
      const remainingSteps = [
        { agent: 'dynamic_tmdb', task: 'lấy poster phim liên quan' },
      ];
      mockSupervisor.evaluate
        // Đánh giá round A (mới resume) — bác bỏ 'done' để chứng minh phải
        // chạy tiếp bước B, KHÔNG tắt sớm.
        .mockResolvedValueOnce({ verdict: 'continue' })
        // Đánh giá round B sau khi chạy xong — đủ điều kiện kết thúc.
        .mockResolvedValueOnce({ verdict: 'done' });
      mockReactLoop.run.mockResolvedValue({
        answer: 'Đã lấy poster phim.',
        toolCalls: [{ tool: 'dynamic_tmdb.get_poster', status: 'success' }],
      });
      mockSupervisor.synthesize.mockResolvedValue(
        'Đã cập nhật đơn và lấy poster phim liên quan.',
      );

      const result = await service.continueRounds(
        data,
        replyMessageId,
        'cập nhật đơn rồi lấy poster phim liên quan',
        agentsWithTmdb,
        [],
        existingRounds,
        [],
        undefined,
        remainingSteps,
      );

      // plan() KHÔNG được gọi lại — resume dùng lại ĐÚNG bước B đã lưu.
      expect(mockSupervisor.plan).not.toHaveBeenCalled();
      // evaluate() được gọi cho round A TRƯỚC khi chạy bước B (trước đây bug:
      // round vừa duyệt không bao giờ đi qua evaluate()).
      expect(mockSupervisor.evaluate).toHaveBeenNthCalledWith(
        1,
        'cập nhật đơn rồi lấy poster phim liên quan',
        existingRounds[0],
        remainingSteps,
        expect.any(Object),
      );
      // Bước B chạy đúng agent của NÓ (dynamic_tmdb), không bị ép ở lại
      // sql_server (bug cũ: agent A không thấy tool của agent B).
      expect(mockReactLoop.run).toHaveBeenCalledWith(
        expect.objectContaining({ provider: 'dynamic_tmdb' }),
        expect.anything(),
        expect.anything(),
      );
      expect(mockSupervisor.evaluate).toHaveBeenNthCalledWith(
        2,
        'cập nhật đơn rồi lấy poster phim liên quan',
        {
          agent: 'dynamic_tmdb',
          task: 'lấy poster phim liên quan',
          result: 'Đã lấy poster phim.',
        },
        [],
        expect.any(Object),
      );
      expect(result.content).toBe(
        'Đã cập nhật đơn và lấy poster phim liên quan.',
      );
    });

    it('pauses for approval again (via CheckpointPauseService) if the continued step also hits the Risk Gate — no special-casing needed by the caller', async () => {
      const existingRounds = [
        {
          agent: 'dynamic_tmdb',
          task: 'lấy danh sách diễn viên',
          result: '[{"name":"A"}]',
        },
      ];
      mockSupervisor.plan.mockResolvedValue({
        action: 'plan',
        steps: [{ agent: 'sql_server', task: 'chèn diễn viên vào bảng users' }],
      });
      const pendingTool = {
        provider: 'sql_server',
        name: 'execute_write_query',
        args: { query: 'INSERT INTO users ...' },
      };
      mockReactLoop.run.mockRejectedValue(
        new ApprovalRequiredError(pendingTool),
      );
      mockCheckpointPause.pauseForApproval.mockResolvedValue({
        content:
          '⏸️ Cần bạn duyệt 1 hành động trước khi tiếp tục — xem tin nhắn bên dưới.',
        toolCalls: undefined,
      });

      const result = await service.continueRounds(
        data,
        replyMessageId,
        'lấy diễn viên rồi chèn vào bảng users',
        availableAgents,
        [],
        existingRounds,
        [],
      );

      expect(mockCheckpointPause.pauseForApproval).toHaveBeenCalledWith(
        data,
        'lấy diễn viên rồi chèn vào bảng users',
        existingRounds,
        [],
        [],
        {
          approvalRequired: pendingTool,
          task: 'chèn diễn viên vào bảng users',
          toolCalls: [],
        },
        // accuracy_problem.md mục 9.2 — kế hoạch (mock plan()) chỉ có đúng 1
        // bước (bước vừa bị chặn) — không còn bước nào khác để lưu lại resume.
        [],
      );
      expect(result.content).toContain('Cần bạn duyệt');
    });

    it('accuracy_problem.md — does NOT grant a fresh non-progress budget on resume — synthesizes and stops immediately once accumulated re-plan/guardrail markers already used up MAX_SUPERVISOR_ROUNDS (regression test for the "pause→resume forever" loop)', async () => {
      // 5 marker "không tiến triển" (re-plan) từ (các) lần resume TRƯỚC —
      // đây là tín hiệu THẬT của vòng lặp bệnh lý, phải cấm resume cấp lại
      // ngân sách mới, KHÔNG liên quan tới số bước THẬT đã chạy.
      const maxedOutNonProgressRounds = Array.from(
        { length: ORCHESTRATION_CONSTANTS.MAX_SUPERVISOR_ROUNDS },
        (_, i) => ({
          agent: 'sql_server',
          task: `bước ${i}`,
          result:
            '[re-plan] evaluate() cho rằng bước vừa xong không đạt kỳ vọng, đã lập lại kế hoạch.',
        }),
      );
      mockSupervisor.synthesize.mockResolvedValue(
        'Tổng hợp lại vì đã hết ngân sách vòng.',
      );

      const result = await service.continueRounds(
        data,
        replyMessageId,
        'lấy diễn viên rồi chèn vào bảng users',
        availableAgents,
        [],
        maxedOutNonProgressRounds,
        [],
      );

      // KHÔNG plan()/delegate thêm — nonProgressRounds đã chạm
      // MAX_SUPERVISOR_ROUNDS ngay từ đầu, đi thẳng vào nhánh fallback tổng hợp.
      expect(mockSupervisor.plan).not.toHaveBeenCalled();
      expect(mockSupervisor.synthesize).toHaveBeenCalledTimes(1);
      expect(result.content).toBe('Tổng hợp lại vì đã hết ngân sách vòng.');
    });

    it('accuracy_problem.md — does NOT stop a long chain of purely REAL steps just because rounds.length is already high — MAX_REAL_STEPS_PER_TURN is much more generous than the non-progress budget, unlike the old shared counter', async () => {
      // 10 bước THẬT đã chạy thành công từ (các) lần resume trước, KHÔNG có
      // marker non-progress nào. Dưới thiết kế CŨ (1 ngân sách chung = 5),
      // continueRounds() sẽ KHÔNG BAO GIỜ gọi plan() ở đây (round=10 đã vượt
      // ngưỡng ngay từ vòng while đầu tiên) — đây chính là lỗ hổng đã sửa.
      const manyRealRounds = Array.from({ length: 10 }, (_, i) => ({
        agent: 'sql_server',
        task: `bước ${i}`,
        result: `kết quả ${i}`,
      }));
      mockSupervisor.plan.mockResolvedValue({
        action: 'respond',
        answer: 'Xong rồi.',
      });
      mockSupervisor.synthesize.mockResolvedValue('Tổng hợp từ 10 bước.');

      const result = await service.continueRounds(
        data,
        replyMessageId,
        'chuỗi dài nhiều bước hợp lệ',
        availableAgents,
        [],
        manyRealRounds,
        [],
      );

      expect(mockSupervisor.plan).toHaveBeenCalledTimes(1);
      // rounds.length > 1 -> finalizeAnswer() bỏ qua plan.answer, gọi
      // synthesize() để nội dung stream = nội dung lưu ("stream = save").
      expect(mockSupervisor.synthesize).toHaveBeenCalledTimes(1);
      expect(result.content).toBe('Tổng hợp từ 10 bước.');
    });

    it('shares ONE non-progress budget across chained approval-resumes instead of resetting it every time', async () => {
      // Mô phỏng: turn đã tiêu (MAX_SUPERVISOR_ROUNDS - 1) lần "không tiến
      // triển" qua các lần resume TRƯỚC — chỉ còn ĐÚNG 1 vé trước khi chạm
      // MAX_SUPERVISOR_ROUNDS.
      const almostMaxedNonProgress = Array.from(
        { length: ORCHESTRATION_CONSTANTS.MAX_SUPERVISOR_ROUNDS - 1 },
        (_, i) => ({
          agent: 'sql_server',
          task: `bước ${i}`,
          result:
            '[re-plan] evaluate() cho rằng bước vừa xong không đạt kỳ vọng, đã lập lại kế hoạch.',
        }),
      );
      mockSupervisor.plan.mockResolvedValue({
        action: 'plan',
        steps: [{ agent: 'sql_server', task: 'thêm 1 bước nữa' }],
      });
      mockReactLoop.run.mockResolvedValue({
        answer: 'vẫn chưa xong',
        toolCalls: [],
      });
      mockSupervisor.evaluate.mockResolvedValue({ verdict: 'replan' });
      mockSupervisor.synthesize.mockResolvedValue(
        'Đành tổng hợp, chưa hội tụ.',
      );

      await service.continueRounds(
        data,
        replyMessageId,
        'lấy diễn viên rồi chèn vào bảng users',
        availableAgents,
        [],
        almostMaxedNonProgress,
        [],
      );

      // Chỉ còn ĐÚNG 1 vé non-progress -> plan() gọi đúng 1 lần rồi hết ngân
      // sách chung, KHÔNG được cấp lại nguyên 5 vòng mới.
      expect(mockSupervisor.plan).toHaveBeenCalledTimes(1);
      expect(mockReactLoop.run).toHaveBeenCalledTimes(1);
    });
  });

  describe('uncertainty clarification (accuracy_problem.md mục 1, gated bởi ENABLE_CLARIFICATION_HITL)', () => {
    const originalEnv = process.env.ENABLE_CLARIFICATION_HITL;
    afterEach(() => {
      if (originalEnv === undefined)
        delete process.env.ENABLE_CLARIFICATION_HITL;
      else process.env.ENABLE_CLARIFICATION_HITL = originalEnv;
    });

    const ambiguousAgents = [
      { provider: 'google_docs', label: 'Google Docs', description: 'desc' },
      { provider: 'notion', label: 'Notion', description: 'desc' },
    ];

    it('pauses for clarification instead of delegating when the flag is on and plan() flags the chosen step as ambiguous', async () => {
      process.env.ENABLE_CLARIFICATION_HITL = 'true';
      mockSupervisor.getAvailableAgents.mockResolvedValue(ambiguousAgents);
      mockSupervisor.plan.mockResolvedValue({
        action: 'plan',
        steps: [{ agent: 'google_docs', task: 'lưu thông tin này lại' }],
        ambiguousCandidates: ambiguousAgents,
      });
      mockCheckpointPause.pauseForClarification.mockResolvedValue({
        content:
          '⏸️ Cần bạn làm rõ trước khi tiếp tục — xem tin nhắn bên dưới.',
        toolCalls: undefined,
      });

      const result = await resolve();

      expect(mockReactLoop.run).not.toHaveBeenCalled();
      expect(mockCheckpointPause.pauseForClarification).toHaveBeenCalledWith(
        data,
        'có bao nhiêu bảng?',
        [],
        [],
        [],
        'lưu thông tin này lại',
        ambiguousAgents,
        // accuracy_problem.md mục 9.2 — kế hoạch (mock plan()) chỉ có đúng 1
        // bước (bước đang mơ hồ) — không còn bước nào khác để lưu lại resume.
        [],
      );
      expect(result.content).toContain('làm rõ');
    });

    it('accuracy_problem.md mục 9.2 — carries the OTHER steps of a multi-step plan (B, C after the ambiguous one) into pauseForClarification() instead of losing them', async () => {
      process.env.ENABLE_CLARIFICATION_HITL = 'true';
      mockSupervisor.getAvailableAgents.mockResolvedValue(ambiguousAgents);
      const stepB = { agent: 'sql_server', task: 'ghi log vào bảng logs' };
      mockSupervisor.plan.mockResolvedValue({
        action: 'plan',
        steps: [{ agent: 'google_docs', task: 'lưu thông tin này lại' }, stepB],
        ambiguousCandidates: ambiguousAgents,
      });
      mockCheckpointPause.pauseForClarification.mockResolvedValue({
        content:
          '⏸️ Cần bạn làm rõ trước khi tiếp tục — xem tin nhắn bên dưới.',
        toolCalls: undefined,
      });

      await resolve();

      expect(mockCheckpointPause.pauseForClarification).toHaveBeenCalledWith(
        data,
        'có bao nhiêu bảng?',
        [],
        [],
        [],
        'lưu thông tin này lại',
        ambiguousAgents,
        [stepB],
      );
    });

    it('does NOT pause for clarification when the flag is off (default), even if plan() flags an ambiguous cluster', async () => {
      // ENABLE_CLARIFICATION_HITL cố ý KHÔNG set — hành vi mặc định.
      mockSupervisor.getAvailableAgents.mockResolvedValue(ambiguousAgents);
      mockSupervisor.plan.mockResolvedValue({
        action: 'plan',
        steps: [{ agent: 'google_docs', task: 'lưu thông tin này lại' }],
        ambiguousCandidates: ambiguousAgents,
      });
      mockReactLoop.run.mockResolvedValue({ answer: 'ok', toolCalls: [] });

      await resolve();

      expect(mockCheckpointPause.pauseForClarification).not.toHaveBeenCalled();
      expect(mockReactLoop.run).toHaveBeenCalled();
    });

    it("does NOT pause for clarification when ambiguousCandidates does not include the chosen step's agent", async () => {
      process.env.ENABLE_CLARIFICATION_HITL = 'true';
      // sql_server KHÔNG nằm trong ambiguousAgents — agent được chọn cho bước
      // này không liên quan gì tới cluster mơ hồ, phải connect thêm nó để
      // delegateRound() tìm thấy targetAgent hợp lệ.
      mockSupervisor.getAvailableAgents.mockResolvedValue([
        ...ambiguousAgents,
        ...availableAgents,
      ]);
      mockSupervisor.plan.mockResolvedValue({
        action: 'plan',
        steps: [{ agent: 'sql_server', task: 'liệt kê bảng' }],
        // Cluster mơ hồ tồn tại NHƯNG không liên quan agent thật sự được chọn
        // cho bước này — an toàn, không nên chặn oan.
        ambiguousCandidates: ambiguousAgents,
      });
      mockReactLoop.run.mockResolvedValue({ answer: 'ok', toolCalls: [] });

      await resolve();

      expect(mockCheckpointPause.pauseForClarification).not.toHaveBeenCalled();
      expect(mockReactLoop.run).toHaveBeenCalled();
    });

    it('executes a forcedStep directly, skipping plan() entirely, when resuming after the user answers a clarification', async () => {
      mockReactLoop.run.mockResolvedValue({ answer: 'Đã lưu.', toolCalls: [] });

      const result = await service.continueRounds(
        data,
        replyMessageId,
        'lưu thông tin này lại',
        availableAgents,
        [],
        [],
        [],
        { agent: 'sql_server', task: 'lưu thông tin này lại' },
      );

      expect(mockSupervisor.plan).not.toHaveBeenCalled();
      expect(mockReactLoop.run).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: 'lưu thông tin này lại',
          provider: 'sql_server',
        }),
        expect.anything(),
        expect.anything(),
      );
      expect(result.content).toBe('Đã lưu.');
    });

    it('accuracy_problem.md mục 9.2 — after resolving a clarification, still runs the OTHER leftover steps (B, C) restored alongside forcedStep, instead of stopping right after it', async () => {
      const agents = [
        ...availableAgents,
        { provider: 'google_docs', label: 'Google Docs', description: 'desc' },
      ];
      const forcedStep = {
        agent: 'google_docs',
        task: 'lưu thông tin này lại',
      };
      const stepB = { agent: 'sql_server', task: 'ghi log vào bảng logs' };
      mockReactLoop.run
        .mockResolvedValueOnce({ answer: 'Đã lưu.', toolCalls: [] })
        .mockResolvedValueOnce({ answer: 'Đã ghi log.', toolCalls: [] });
      mockSupervisor.evaluate.mockResolvedValueOnce({ verdict: 'continue' });
      mockSupervisor.synthesize.mockResolvedValue('Đã lưu và ghi log.');

      const result = await service.continueRounds(
        data,
        replyMessageId,
        'lưu thông tin này lại rồi ghi log',
        agents,
        [],
        [],
        [],
        forcedStep,
        [stepB],
      );

      expect(mockSupervisor.plan).not.toHaveBeenCalled();
      expect(mockReactLoop.run).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ provider: 'google_docs' }),
        expect.anything(),
        expect.anything(),
      );
      // Bước B KHÔNG bị mất — vẫn chạy sau forcedStep, đúng agent của nó.
      expect(mockReactLoop.run).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ provider: 'sql_server' }),
        expect.anything(),
        expect.anything(),
      );
      expect(result.content).toBe('Đã lưu và ghi log.');
    });

    it('Bug fix — does not crash when a step has null or undefined task (JSON schema output is not strict)', async () => {
      mockSupervisor.plan.mockResolvedValue({
        action: 'plan',
        steps: [{ agent: 'sql_server', task: null, mustExecute: true }],
      });
      mockReactLoop.run.mockResolvedValue({ answer: 'ok', toolCalls: [] });

      await expect(resolve()).resolves.not.toThrow();
    });

    it('Bug fix — propagates TurnCancelledError without swallowing it as a generic external service error', async () => {
      mockSupervisor.plan.mockResolvedValue({
        action: 'plan',
        steps: [{ agent: 'sql_server', task: 'some task', mustExecute: true }],
      });
      mockReactLoop.run.mockRejectedValue(
        new TurnCancelledError('partial stream'),
      );

      await expect(resolve()).rejects.toMatchObject({
        name: 'TurnCancelledError',
        partialText: 'partial stream',
      });
    });
  });
});
