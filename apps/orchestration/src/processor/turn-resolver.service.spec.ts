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

describe('TurnResolverService', () => {
  let service: TurnResolverService;

  const mockMessageClient = {
    getMessageText: jest.fn(),
    getRecentHistory: jest.fn(),
  };
  const mockReactLoop = { run: jest.fn() };
  const mockSupervisor = {
    getAvailableAgents: jest.fn(),
    decide: jest.fn(),
    synthesize: jest.fn(),
  };
  const mockAgentStream = { emitStep: jest.fn() };
  const mockCancellation = { isCancelled: jest.fn().mockResolvedValue(false) };
  const mockCheckpointPause = { pauseForApproval: jest.fn() };

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

  it('returns the Supervisor answer directly when action is "respond" — no ReAct loop involved', async () => {
    mockSupervisor.decide.mockResolvedValue({
      action: 'respond',
      answer: 'Chào bạn!',
    });

    const result = await resolve();

    expect(mockReactLoop.run).not.toHaveBeenCalled();
    expect(result).toEqual({ content: 'Chào bạn!', toolCalls: undefined });
  });

  it('falls back to a default message when Supervisor responds with action="respond" but no answer text', async () => {
    mockSupervisor.decide.mockResolvedValue({ action: 'respond' });

    const result = await resolve();

    expect(result.content).toBe('Xin lỗi, mình chưa có câu trả lời phù hợp.');
  });

  it('dedupes delegations to the SAME agent within one round, keeping only the first task', async () => {
    mockSupervisor.decide
      .mockResolvedValueOnce({
        action: 'delegate',
        delegations: [
          { agent: 'sql_server', task: 'đếm đơn Completed' },
          { agent: 'sql_server', task: 'đếm đơn Pending' },
        ],
      })
      .mockResolvedValueOnce({ action: 'respond', answer: 'Xong' });
    mockReactLoop.run.mockResolvedValue({ answer: 'ok', toolCalls: [] });

    await resolve();

    expect(mockReactLoop.run).toHaveBeenCalledTimes(1);
    expect(mockReactLoop.run).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: 'đếm đơn Completed' }),
    );
  });

  it('delegates to ReactLoopService with the Supervisor-authored task when action is "delegate"', async () => {
    mockSupervisor.decide
      .mockResolvedValueOnce({
        action: 'delegate',
        delegations: [{ agent: 'sql_server', task: 'liệt kê bảng' }],
      })
      .mockResolvedValueOnce({ action: 'respond', answer: 'Có 2 bảng.' });
    mockReactLoop.run.mockResolvedValue({
      answer: 'Có 2 bảng.',
      toolCalls: [{ tool: 'get_database_schema', status: 'success' }],
    });

    const result = await resolve();

    expect(mockReactLoop.run).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: 'liệt kê bảng',
        provider: 'sql_server',
        userId: data.userId,
        messageId: replyMessageId, // reply id, KHÔNG phải messageId gốc — FE update đúng bubble bot
        history: [],
      }),
    );
    expect(result).toEqual({
      content: 'Có 2 bảng.',
      toolCalls: [{ tool: 'get_database_schema', status: 'success' }],
    });
  });

  it('falls back to the original user prompt when a delegation has no "task" text of its own', async () => {
    mockSupervisor.decide
      .mockResolvedValueOnce({
        action: 'delegate',
        delegations: [{ agent: 'sql_server', task: '' }],
      })
      .mockResolvedValueOnce({ action: 'respond', answer: 'ok' });
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
    mockSupervisor.decide
      .mockResolvedValueOnce({
        action: 'delegate',
        delegations: [{ agent: 'Themoviedb', task: 'tìm phim' }],
      })
      .mockResolvedValueOnce({ action: 'respond', answer: 'Đã tìm xong.' });
    mockReactLoop.run.mockResolvedValue({ answer: 'ok', toolCalls: [] });

    await resolve();

    expect(mockReactLoop.run).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'dynamic_12345' }),
    );
  });

  it('falls back to a safe message and skips ReactLoopService when Supervisor delegates to an agent outside the available list', async () => {
    mockSupervisor.decide.mockResolvedValue({
      action: 'delegate',
      delegations: [{ agent: 'notion', task: 'đọc trang' }],
    });

    const result = await resolve();

    expect(mockReactLoop.run).not.toHaveBeenCalled();
    expect(result.content).toContain('Settings');
  });

  it('treats a missing "delegations" field on action="delegate" the same as an empty array, instead of throwing', async () => {
    mockSupervisor.decide.mockResolvedValue({ action: 'delegate' });

    const result = await resolve();

    expect(mockReactLoop.run).not.toHaveBeenCalled();
    expect(result.content).toContain('Settings');
  });

  it('records an explicit "unavailable" round for an invalid agent MIXED with a valid one, instead of silently dropping it', async () => {
    const twoAgents = [
      { provider: 'sql_server', label: 'SQL Server', description: 'desc' },
      { provider: 'github', label: 'GitHub', description: 'desc' },
    ];
    mockSupervisor.getAvailableAgents.mockResolvedValue(twoAgents);
    mockSupervisor.decide
      .mockResolvedValueOnce({
        action: 'delegate',
        delegations: [
          { agent: 'sql_server', task: 'đếm số bảng' },
          { agent: 'notion', task: 'đọc trang ghi chú' },
        ],
      })
      .mockResolvedValueOnce({ action: 'respond', answer: 'Có 5 bảng.' });
    mockReactLoop.run.mockResolvedValue({ answer: 'Có 5 bảng', toolCalls: [] });

    await resolve();

    expect(mockReactLoop.run).toHaveBeenCalledTimes(1);
    const secondCallRounds = mockSupervisor.decide.mock.calls[1][2];
    expect(secondCallRounds).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          agent: 'notion',
          result: expect.stringContaining('chưa khả dụng'),
        }),
      ]),
    );
  });

  it("keeps a sibling delegation's successful result even when another delegation in the SAME round throws (Step 8 — Promise.all fail-fast guard)", async () => {
    const twoAgents = [
      { provider: 'sql_server', label: 'SQL Server', description: 'desc' },
      { provider: 'github', label: 'GitHub', description: 'desc' },
    ];
    mockSupervisor.getAvailableAgents.mockResolvedValue(twoAgents);
    mockSupervisor.decide
      .mockResolvedValueOnce({
        action: 'delegate',
        delegations: [
          { agent: 'sql_server', task: 'đếm số bảng' },
          { agent: 'github', task: 'tạo issue' },
        ],
      })
      .mockResolvedValueOnce({
        action: 'respond',
        answer: 'Đã có 5 bảng, GitHub thì lỗi.',
      });
    mockReactLoop.run.mockImplementation((dto: { provider: string }) =>
      dto.provider === 'sql_server'
        ? Promise.resolve({
            answer: 'Có 5 bảng',
            toolCalls: [
              { tool: 'sql_server.get_database_schema', status: 'success' },
            ],
          })
        : Promise.reject(new Error('connect ECONNREFUSED')),
    );
    mockSupervisor.synthesize.mockResolvedValue(
      'Đã có 5 bảng, GitHub thì lỗi.',
    );

    const result = await resolve();

    const secondCallRounds = mockSupervisor.decide.mock.calls[1][2];
    expect(secondCallRounds).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ agent: 'sql_server', result: 'Có 5 bảng' }),
        expect.objectContaining({
          agent: 'github',
          result: expect.stringContaining('ECONNREFUSED'),
        }),
      ]),
    );
    expect(mockSupervisor.synthesize).toHaveBeenCalledWith(
      'có bao nhiêu bảng?',
      secondCallRounds,
      expect.any(Function),
      expect.anything(),
    );
    expect(result.content).toBe('Đã có 5 bảng, GitHub thì lỗi.');
  });

  it('runs a second Supervisor round, feeding round-1 result back in, before producing the final answer (Step 3)', async () => {
    mockSupervisor.decide
      .mockResolvedValueOnce({
        action: 'delegate',
        delegations: [{ agent: 'sql_server', task: 'tìm bảng có cột Email' }],
      })
      .mockResolvedValueOnce({
        action: 'respond',
        answer: 'Bảng Users có cột Email, có 10 dòng.',
      });
    mockReactLoop.run.mockResolvedValueOnce({
      answer: 'Bảng Users có cột Email',
      toolCalls: [{ tool: 'get_database_schema', status: 'success' }],
    });

    const result = await resolve();

    expect(mockSupervisor.decide).toHaveBeenCalledTimes(2);
    expect(mockSupervisor.decide).toHaveBeenNthCalledWith(
      2,
      'có bao nhiêu bảng?',
      availableAgents,
      [
        {
          agent: 'sql_server',
          task: 'tìm bảng có cột Email',
          result: 'Bảng Users có cột Email',
        },
      ],
      [],
    );
    expect(mockReactLoop.run).toHaveBeenCalledTimes(1);
    // Nguyên tắc "stream = save": đúng 1 delegate đã trả lời (rounds.length === 1) nên
    // content trả về phải là answer ReactLoop ĐÃ STREAM, KHÔNG phải bản decide() paraphrase thêm.
    expect(result).toEqual({
      content: 'Bảng Users có cột Email',
      toolCalls: [{ tool: 'get_database_schema', status: 'success' }],
    });
  });

  it('fans out to MULTIPLE independent agents in the SAME round when Supervisor returns >1 delegation (Step 8)', async () => {
    const twoAgents = [
      { provider: 'sql_server', label: 'SQL Server', description: 'desc' },
      { provider: 'github', label: 'GitHub', description: 'desc' },
    ];
    mockSupervisor.getAvailableAgents.mockResolvedValue(twoAgents);
    mockSupervisor.decide
      .mockResolvedValueOnce({
        action: 'delegate',
        delegations: [
          { agent: 'sql_server', task: 'đếm số bảng' },
          { agent: 'github', task: 'liệt kê issue đang mở' },
        ],
      })
      .mockResolvedValueOnce({
        action: 'respond',
        answer: 'Có 5 bảng và 3 issue đang mở.',
      });
    mockReactLoop.run.mockImplementation((dto: { provider: string }) =>
      dto.provider === 'sql_server'
        ? Promise.resolve({
            answer: 'Có 5 bảng',
            toolCalls: [
              { tool: 'sql_server.get_database_schema', status: 'success' },
            ],
          })
        : Promise.resolve({
            answer: '3 issue đang mở',
            toolCalls: [{ tool: 'github.list_issues', status: 'success' }],
          }),
    );
    mockSupervisor.synthesize.mockResolvedValue(
      'Có 5 bảng và 3 issue đang mở.',
    );

    const result = await resolve();

    expect(mockSupervisor.decide).toHaveBeenCalledTimes(2);
    expect(mockReactLoop.run).toHaveBeenCalledTimes(2);
    // streamKey khác nhau giữa 2 agent chạy CÙNG round (fan-out) — nếu không,
    // FE gộp chung 1 chuỗi text và agent này resync() sẽ xoá mất phần agent kia.
    expect(mockReactLoop.run).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'sql_server', streamKey: 'r0-sql_server' }),
    );
    expect(mockReactLoop.run).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'github', streamKey: 'r0-github' }),
    );
    const secondCallRounds = mockSupervisor.decide.mock.calls[1][2];
    expect(secondCallRounds).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ agent: 'sql_server', result: 'Có 5 bảng' }),
        expect.objectContaining({ agent: 'github', result: '3 issue đang mở' }),
      ]),
    );
    expect(result.content).toBe('Có 5 bảng và 3 issue đang mở.');
  });

  it('chains 2 DIFFERENT agents across rounds and aggregates their toolCalls in order (Step 5 — real cross-agent case)', async () => {
    const twoAgents = [
      { provider: 'sql_server', label: 'SQL Server', description: 'desc' },
      { provider: 'github', label: 'GitHub', description: 'desc' },
    ];
    mockSupervisor.getAvailableAgents.mockResolvedValue(twoAgents);
    mockSupervisor.decide
      .mockResolvedValueOnce({
        action: 'delegate',
        delegations: [
          { agent: 'sql_server', task: 'tìm khách chi tiêu nhiều nhất' },
        ],
      })
      .mockResolvedValueOnce({
        action: 'delegate',
        delegations: [
          {
            agent: 'github',
            task: 'tạo issue nhắc follow-up khách Nguyễn Văn A, 5.000.000đ',
          },
        ],
      })
      .mockResolvedValueOnce({
        action: 'respond',
        answer: 'Đã tìm khách VIP và tạo issue GitHub nhắc follow-up.',
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
    mockSupervisor.synthesize.mockResolvedValue(
      'Đã tìm khách VIP và tạo issue GitHub nhắc follow-up.',
    );

    const result = await resolve();

    const secondCallArgs = mockSupervisor.decide.mock.calls[1];
    expect(secondCallArgs[0]).toBe('có bao nhiêu bảng?');
    expect(secondCallArgs[1]).toEqual(twoAgents);
    expect((secondCallArgs[2] as unknown[]).slice(0, 1)).toEqual([
      {
        agent: 'sql_server',
        task: 'tìm khách chi tiêu nhiều nhất',
        result: 'Khách chi tiêu nhiều nhất: Nguyễn Văn A, 5.000.000đ',
      },
    ]);
    expect(mockReactLoop.run).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ provider: 'sql_server', streamKey: 'r0-sql_server' }),
    );
    expect(mockReactLoop.run).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ provider: 'github', streamKey: 'r1-github' }),
    );
    expect(result).toEqual({
      content: 'Đã tìm khách VIP và tạo issue GitHub nhắc follow-up.',
      toolCalls: [
        { tool: 'sql_server.execute_read_only_query', status: 'success' },
        { tool: 'github.create_issue', status: 'success' },
      ],
    });
  });

  it('stops after MAX_SUPERVISOR_ROUNDS and asks Supervisor to synthesize all collected rounds instead of returning the raw last round (Step 9)', async () => {
    mockSupervisor.decide.mockResolvedValue({
      action: 'delegate',
      delegations: [{ agent: 'sql_server', task: 'tiếp tục' }],
    });
    let call = 0;
    mockReactLoop.run.mockImplementation(() =>
      Promise.resolve({ answer: `kết quả vòng ${++call}`, toolCalls: [] }),
    );
    mockSupervisor.synthesize.mockResolvedValue(
      'Tổng hợp toàn bộ các vòng đã thu thập được.',
    );

    const result = await resolve();

    expect(mockSupervisor.decide).toHaveBeenCalledTimes(
      ORCHESTRATION_CONSTANTS.MAX_SUPERVISOR_ROUNDS,
    );
    expect(mockReactLoop.run).toHaveBeenCalledTimes(
      ORCHESTRATION_CONSTANTS.MAX_SUPERVISOR_ROUNDS,
    );
    expect(mockSupervisor.synthesize).toHaveBeenCalledTimes(1);
    const [synthesizePrompt, synthesizeRounds] =
      mockSupervisor.synthesize.mock.calls[0];
    expect(synthesizePrompt).toBe('có bao nhiêu bảng?');
    expect(synthesizeRounds).toHaveLength(
      ORCHESTRATION_CONSTANTS.MAX_SUPERVISOR_ROUNDS,
    );
    expect(result.content).toBe('Tổng hợp toàn bộ các vòng đã thu thập được.');
  });

  it('rejects with TurnCancelledError, carrying the last delegate result, when Stop is requested between Supervisor rounds', async () => {
    mockSupervisor.decide.mockResolvedValue({
      action: 'delegate',
      delegations: [{ agent: 'sql_server', task: 'liệt kê bảng' }],
    });
    mockReactLoop.run.mockResolvedValue({ answer: 'Có 2 bảng', toolCalls: [] });
    mockCancellation.isCancelled
      .mockResolvedValueOnce(false) // round 0
      .mockResolvedValueOnce(true); // round 1 — Stop được bấm giữa chừng

    await expect(resolve()).rejects.toThrow(TurnCancelledError);
  });

  it('delegates to CheckpointPauseService and returns its answer when a delegation hits the Risk Gate', async () => {
    mockSupervisor.decide.mockResolvedValue({
      action: 'delegate',
      delegations: [
        { agent: 'sql_server', task: 'cập nhật status đơn OrderId=1' },
      ],
    });
    const pendingTool = {
      provider: 'sql_server',
      name: 'execute_write_query',
      args: { query: "UPDATE Orders SET Status='Completed' WHERE OrderId=1" },
    };
    mockReactLoop.run.mockRejectedValue(new ApprovalRequiredError(pendingTool));
    mockCheckpointPause.pauseForApproval.mockResolvedValue({
      content: '⏸️ Cần bạn duyệt 1 hành động trước khi tiếp tục — xem tin nhắn bên dưới.',
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

  it("keeps a sibling delegation's successful result in the rounds passed to CheckpointPauseService when it completes in the SAME round as one needing approval", async () => {
    const twoAgents = [
      { provider: 'sql_server', label: 'SQL Server', description: 'desc' },
      { provider: 'github', label: 'GitHub', description: 'desc' },
    ];
    mockSupervisor.getAvailableAgents.mockResolvedValue(twoAgents);
    mockSupervisor.decide.mockResolvedValue({
      action: 'delegate',
      delegations: [
        { agent: 'sql_server', task: 'xoá đơn OrderId=1' },
        { agent: 'github', task: 'liệt kê issue' },
      ],
    });
    const pendingTool = {
      provider: 'sql_server',
      name: 'execute_write_query',
      args: { query: 'DELETE FROM Orders WHERE OrderId=1' },
    };
    mockReactLoop.run.mockImplementation((dto: { provider: string }) =>
      dto.provider === 'sql_server'
        ? Promise.reject(new ApprovalRequiredError(pendingTool))
        : Promise.resolve({
            answer: '3 issue đang mở',
            toolCalls: [{ tool: 'github.list_issues', status: 'success' }],
          }),
    );
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

  it('checkpoints only the FIRST delegation needing approval when TWO delegations in the same round both hit the Risk Gate, but keeps toolCalls from BOTH', async () => {
    const twoAgents = [
      { provider: 'sql_server', label: 'SQL Server', description: 'desc' },
      { provider: 'github', label: 'GitHub', description: 'desc' },
    ];
    mockSupervisor.getAvailableAgents.mockResolvedValue(twoAgents);
    mockSupervisor.decide.mockResolvedValue({
      action: 'delegate',
      delegations: [
        { agent: 'sql_server', task: 'xoá đơn OrderId=1' },
        { agent: 'github', task: 'tạo issue xoá đơn' },
      ],
    });
    const sqlTool = { provider: 'sql_server', name: 'execute_write_query', args: {} };
    const githubTool = { provider: 'github', name: 'create_issue', args: {} };
    mockReactLoop.run.mockImplementation((dto: { provider: string }) =>
      dto.provider === 'sql_server'
        ? Promise.reject(
            new ApprovalRequiredError(sqlTool, [
              { tool: 'sql_server.get_database_schema', status: 'success' },
            ]),
          )
        : Promise.reject(
            new ApprovalRequiredError(githubTool, [
              { tool: 'github.list_issues', status: 'success' },
            ]),
          ),
    );
    mockCheckpointPause.pauseForApproval.mockResolvedValue({
      content: 'paused',
      toolCalls: undefined,
    });

    await resolve();

    const approvalNeededArg =
      mockCheckpointPause.pauseForApproval.mock.calls[0][5];
    expect(approvalNeededArg.approvalRequired).toEqual(sqlTool);
    const toolCallsArg = mockCheckpointPause.pauseForApproval.mock.calls[0][3];
    expect(toolCallsArg).toEqual(
      expect.arrayContaining([
        { tool: 'sql_server.get_database_schema', status: 'success' },
        { tool: 'github.list_issues', status: 'success' },
      ]),
    );
  });

  it('does NOT execute the destructive tool for real (mcpClient.callTool is inside ReactLoop, mocked to reject before ever running it)', async () => {
    mockSupervisor.decide.mockResolvedValue({
      action: 'delegate',
      delegations: [{ agent: 'sql_server', task: 'xoá đơn OrderId=1' }],
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
    // thật) đúng 1 lần — không có vòng Supervisor tiếp theo nào chạy tiếp.
    expect(mockReactLoop.run).toHaveBeenCalledTimes(1);
    expect(mockSupervisor.decide).toHaveBeenCalledTimes(1);
  });

  describe('continueRounds (resume sau khi duyệt 1 hành động — dùng lại bởi ApprovalFlowService)', () => {
    it('feeds the pre-existing round in as context to decide(), instead of starting from an empty history', async () => {
      const existingRounds = [
        {
          agent: 'dynamic_tmdb',
          task: 'lấy danh sách diễn viên',
          result: '[{"name":"A"},{"name":"B"}]',
        },
      ];
      mockSupervisor.decide.mockResolvedValue({
        action: 'delegate',
        delegations: [{ agent: 'sql_server', task: 'chèn diễn viên vào bảng users' }],
      });
      mockReactLoop.run.mockResolvedValue({
        answer: 'Đã chèn 2 diễn viên vào bảng users.',
        toolCalls: [{ tool: 'sql_server.execute_write_query', status: 'success' }],
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

      expect(mockSupervisor.decide).toHaveBeenCalledWith(
        'lấy diễn viên rồi chèn vào bảng users',
        availableAgents,
        existingRounds,
        [],
      );
      // Vòng MỚI (sau resume) delegate sang ĐÚNG provider cần thiết cho phần
      // còn lại (sql_server) — KHÔNG bị ép ở lại provider vừa dùng trước đó.
      expect(mockReactLoop.run).toHaveBeenCalledWith(
        expect.objectContaining({ provider: 'sql_server' }),
      );
    });

    it('does NOT grant a fresh MAX_SUPERVISOR_ROUNDS budget on resume — synthesizes and stops immediately once the accumulated rounds already used up the shared budget (regression test for the "pause→resume forever" loop)', async () => {
      const maxedOutRounds = Array.from(
        { length: ORCHESTRATION_CONSTANTS.MAX_SUPERVISOR_ROUNDS },
        (_, i) => ({ agent: 'sql_server', task: `bước ${i}`, result: `kết quả ${i}` }),
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
        maxedOutRounds,
        [],
      );

      // KHÔNG decide()/delegate thêm — rounds đã chạm MAX_SUPERVISOR_ROUNDS
      // ngay từ đầu, đi thẳng vào nhánh fallback tổng hợp.
      expect(mockSupervisor.decide).not.toHaveBeenCalled();
      expect(mockSupervisor.synthesize).toHaveBeenCalledTimes(1);
      expect(result.content).toBe('Tổng hợp lại vì đã hết ngân sách vòng.');
    });

    it('shares ONE MAX_SUPERVISOR_ROUNDS budget across chained approval-resumes instead of resetting it every time', async () => {
      // Mô phỏng: turn đã tiêu (MAX_SUPERVISOR_ROUNDS - 1) vòng qua các lần
      // resume TRƯỚC — chỉ còn ĐÚNG 1 vòng ngân sách cho lần continueRounds() này.
      const almostMaxedRounds = Array.from(
        { length: ORCHESTRATION_CONSTANTS.MAX_SUPERVISOR_ROUNDS - 1 },
        (_, i) => ({ agent: 'sql_server', task: `bước ${i}`, result: `kết quả ${i}` }),
      );
      mockSupervisor.decide.mockResolvedValue({
        action: 'delegate',
        delegations: [{ agent: 'sql_server', task: 'thêm 1 bước nữa' }],
      });
      mockReactLoop.run.mockResolvedValue({ answer: 'vẫn chưa xong', toolCalls: [] });
      mockSupervisor.synthesize.mockResolvedValue('Đành tổng hợp, chưa hội tụ.');

      await service.continueRounds(
        data,
        replyMessageId,
        'lấy diễn viên rồi chèn vào bảng users',
        availableAgents,
        [],
        almostMaxedRounds,
        [],
      );

      // Chỉ còn ĐÚNG 1 vòng ngân sách -> decide() gọi đúng 1 lần rồi hết ngân
      // sách chung, KHÔNG được cấp lại nguyên 5 vòng mới.
      expect(mockSupervisor.decide).toHaveBeenCalledTimes(1);
    });

    it('pauses for approval again (via CheckpointPauseService) if the continued round also hits the Risk Gate — no special-casing needed by the caller', async () => {
      const existingRounds = [
        {
          agent: 'dynamic_tmdb',
          task: 'lấy danh sách diễn viên',
          result: '[{"name":"A"}]',
        },
      ];
      mockSupervisor.decide.mockResolvedValue({
        action: 'delegate',
        delegations: [{ agent: 'sql_server', task: 'chèn diễn viên vào bảng users' }],
      });
      const pendingTool = {
        provider: 'sql_server',
        name: 'execute_write_query',
        args: { query: "INSERT INTO users ..." },
      };
      mockReactLoop.run.mockRejectedValue(new ApprovalRequiredError(pendingTool));
      mockCheckpointPause.pauseForApproval.mockResolvedValue({
        content: '⏸️ Cần bạn duyệt 1 hành động trước khi tiếp tục — xem tin nhắn bên dưới.',
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
  });
});
