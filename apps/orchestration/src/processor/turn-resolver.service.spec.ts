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
  };
  const mockAgentStream = { emitStep: jest.fn() };
  const mockCancellation = { isCancelled: jest.fn().mockResolvedValue(false) };
  const mockCheckpointPause = {
    pauseForApproval: jest.fn(),
    pauseForClarification: jest.fn(),
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
    );
    expect(mockSupervisor.evaluate).toHaveBeenCalledWith(
      'có bao nhiêu bảng?',
      { agent: 'sql_server', task: 'liệt kê bảng', result: 'Có 2 bảng.' },
      [],
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
    );
    expect(mockReactLoop.run).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ provider: 'github', streamKey: 'r1-github' }),
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
      .mockResolvedValueOnce({ verdict: 're-plan' })
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
      );
      expect(mockSupervisor.synthesize).toHaveBeenCalledTimes(1);
      expect(result.content).toBe('Đã lưu nội dung vào Google Docs.');
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
    mockSupervisor.evaluate.mockResolvedValue({ verdict: 're-plan' });
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
    mockSupervisor.evaluate.mockResolvedValue({ verdict: 're-plan' });

    await expect(resolve()).rejects.toThrow(TurnCancelledError);
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
    );
    expect(result.content).toContain('Cần bạn duyệt');
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
      );
      // Bước MỚI (sau resume) delegate sang ĐÚNG provider cần thiết cho phần
      // còn lại (sql_server) — KHÔNG bị ép ở lại provider vừa dùng trước đó.
      expect(mockReactLoop.run).toHaveBeenCalledWith(
        expect.objectContaining({ provider: 'sql_server' }),
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
      mockSupervisor.evaluate.mockResolvedValue({ verdict: 're-plan' });
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
      );
      expect(result.content).toContain('làm rõ');
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
      );
      expect(result.content).toBe('Đã lưu.');
    });
  });
});
