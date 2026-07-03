import { Test, TestingModule } from '@nestjs/testing';
import { Job } from 'bullmq';
import { EJobName, IProcessAiTriggerJobData } from '@slack/queue';
import { ORCHESTRATION_CONSTANTS } from '@slack/constants';
import { AiOrchestrationProcessor } from './ai-orchestration.processor';
import { MessageClientService } from '../message-client.service';
import { ReactLoopService } from '../llm/react-loop.service';
import { SupervisorService } from '../llm/supervisor.service';
import { AgentStreamService } from '../socket/agent-stream.service';

// ai-orchestration.processor.ts import ReactLoopService (dù đã mock qua DI ở
// dưới) — file thật của nó vẫn import @slack/common ở module scope, kéo theo
// "nanoid" (ESM-only) mà jest không transform được. Mock thẳng barrel, cùng
// convention đã dùng ở auth.service.spec.ts.
jest.mock('@slack/common', () => ({ extractTextFromMcpResult: jest.fn() }));

describe('AiOrchestrationProcessor', () => {
  let processor: AiOrchestrationProcessor;

  const mockMessageClient = {
    createMessage: jest.fn(),
    updateMessage: jest.fn(),
    getMessageText: jest.fn(),
    getRecentHistory: jest.fn(),
  };
  const mockReactLoop = { run: jest.fn() };
  const mockSupervisor = { getAvailableAgents: jest.fn(), decide: jest.fn(), synthesize: jest.fn() };
  const mockAgentStream = { emitStep: jest.fn() };

  const jobData: IProcessAiTriggerJobData = {
    userId: 'user-1',
    channelId: 'channel-1',
    workspaceId: 'workspace-1',
    messageId: 'trigger-msg-1',
    botUserId: 'bot-1',
    channelType: 'direct',
  };

  const availableAgents = [{ provider: 'sql_server', label: 'SQL Server', description: 'desc' }];

  beforeEach(async () => {
    mockMessageClient.createMessage.mockResolvedValue({ id: 'reply-1' });
    mockMessageClient.getMessageText.mockResolvedValue('có bao nhiêu bảng?');
    mockMessageClient.getRecentHistory.mockResolvedValue([]);
    mockSupervisor.getAvailableAgents.mockResolvedValue(availableAgents);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AiOrchestrationProcessor,
        { provide: MessageClientService, useValue: mockMessageClient },
        { provide: ReactLoopService, useValue: mockReactLoop },
        { provide: SupervisorService, useValue: mockSupervisor },
        { provide: AgentStreamService, useValue: mockAgentStream },
      ],
    }).compile();

    processor = module.get<AiOrchestrationProcessor>(AiOrchestrationProcessor);
  });

  afterEach(() => jest.clearAllMocks());

  const runJob = (data: IProcessAiTriggerJobData = jobData) =>
    processor.process({ name: EJobName.PROCESS_AI_TRIGGER, data } as Job<IProcessAiTriggerJobData, void, EJobName>);

  it('creates a placeholder message before doing anything else', async () => {
    mockSupervisor.decide.mockResolvedValue({ action: 'respond', answer: 'Chào bạn!' });

    await runJob();

    expect(mockMessageClient.createMessage).toHaveBeenCalledWith({
      channelId: jobData.channelId,
      senderId: jobData.botUserId,
      content: '🤖 Đang xử lý...',
    });
  });

  it('updates the reply with the Supervisor answer directly when action is "respond" — no ReAct loop involved', async () => {
    mockSupervisor.decide.mockResolvedValue({ action: 'respond', answer: 'Chào bạn!' });

    await runJob();

    expect(mockReactLoop.run).not.toHaveBeenCalled();
    expect(mockMessageClient.updateMessage).toHaveBeenCalledWith({
      id: 'reply-1',
      userId: jobData.botUserId,
      content: 'Chào bạn!',
    });
    // "done" phải bắn dù Supervisor tự trả lời — không đi qua ReactLoopService
    // nào cả, nên đây là nơi DUY NHẤT có thể phát tín hiệu này cho FE.
    expect(mockAgentStream.emitStep).toHaveBeenCalledWith(
      { userId: jobData.userId, channelId: jobData.channelId, messageId: 'reply-1', channelType: jobData.channelType },
      { type: 'done' },
    );
  });

  it('delegates to ReactLoopService with the Supervisor-authored task when action is "delegate"', async () => {
    // Vòng 1: delegate. Vòng 2: Supervisor thấy đủ dữ liệu, respond luôn —
    // dùng mockResolvedValueOnce cho từng vòng vì decide() giờ được gọi lặp
    // lại (Step 3), không còn đúng 1 lần/turn như trước.
    mockSupervisor.decide
      .mockResolvedValueOnce({ action: 'delegate', delegations: [{ agent: 'sql_server', task: 'liệt kê bảng' }] })
      .mockResolvedValueOnce({ action: 'respond', answer: 'Có 2 bảng.' });
    mockReactLoop.run.mockResolvedValue({
      answer: 'Có 2 bảng.',
      toolCalls: [{ tool: 'get_database_schema', status: 'success' }],
    });

    await runJob();

    expect(mockReactLoop.run).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: 'liệt kê bảng',
        provider: 'sql_server',
        userId: jobData.userId,
        messageId: 'reply-1', // reply id, KHÔNG phải messageId gốc — FE update đúng bubble bot
        history: [],
      }),
    );
    expect(mockMessageClient.updateMessage).toHaveBeenCalledWith({
      id: 'reply-1',
      userId: jobData.botUserId,
      content: 'Có 2 bảng.',
      toolCalls: [{ tool: 'get_database_schema', status: 'success' }],
    });
    expect(mockAgentStream.emitStep).toHaveBeenCalledWith(expect.anything(), { type: 'done' });
  });

  it('falls back to a safe message and skips ReactLoopService when Supervisor delegates to an agent outside the available list', async () => {
    // "notion" không có trong availableAgents
    mockSupervisor.decide.mockResolvedValue({ action: 'delegate', delegations: [{ agent: 'notion', task: 'đọc trang' }] });

    await runJob();

    expect(mockReactLoop.run).not.toHaveBeenCalled();
    expect(mockMessageClient.updateMessage).toHaveBeenCalledWith({
      id: 'reply-1',
      userId: jobData.botUserId,
      content: expect.stringContaining('Settings'),
    });
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
        // "notion" không nằm trong twoAgents — lẫn cùng vòng với 1 agent hợp lệ
        delegations: [
          { agent: 'sql_server', task: 'đếm số bảng' },
          { agent: 'notion', task: 'đọc trang ghi chú' },
        ],
      })
      .mockResolvedValueOnce({ action: 'respond', answer: 'Có 5 bảng.' });
    mockReactLoop.run.mockResolvedValue({ answer: 'Có 5 bảng', toolCalls: [] });

    await runJob();

    // agent hợp lệ vẫn chạy bình thường
    expect(mockReactLoop.run).toHaveBeenCalledTimes(1);
    // vòng 2 Supervisor phải THẤY rõ "notion" đã bị bỏ qua, không phải im lặng biến mất
    const secondCallRounds = mockSupervisor.decide.mock.calls[1][2];
    expect(secondCallRounds).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ agent: 'notion', result: expect.stringContaining('chưa khả dụng') }),
      ]),
    );
  });

  it('keeps a sibling delegation\'s successful result even when another delegation in the SAME round throws (Step 8 — Promise.all fail-fast guard)', async () => {
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
      .mockResolvedValueOnce({ action: 'respond', answer: 'Đã có 5 bảng, GitHub thì lỗi.' });
    mockReactLoop.run.mockImplementation((dto: { provider: string }) =>
      dto.provider === 'sql_server'
        ? Promise.resolve({ answer: 'Có 5 bảng', toolCalls: [{ tool: 'sql_server.get_database_schema', status: 'success' }] })
        : Promise.reject(new Error('connect ECONNREFUSED')),
    );

    await runJob();

    // Kết quả sql_server KHÔNG bị mất dù github ném lỗi trong CÙNG Promise.all
    const secondCallRounds = mockSupervisor.decide.mock.calls[1][2];
    expect(secondCallRounds).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ agent: 'sql_server', result: 'Có 5 bảng' }),
        expect.objectContaining({ agent: 'github', result: expect.stringContaining('ECONNREFUSED') }),
      ]),
    );
    // Lỗi 1 nhánh không làm sập cả turn — vẫn respond bình thường ở vòng 2
    expect(mockMessageClient.updateMessage).toHaveBeenCalledWith(
      expect.objectContaining({ content: 'Đã có 5 bảng, GitHub thì lỗi.' }),
    );
  });

  it('runs a second Supervisor round, feeding round-1 result back in, before producing the final answer (Step 3)', async () => {
    mockSupervisor.decide
      .mockResolvedValueOnce({ action: 'delegate', delegations: [{ agent: 'sql_server', task: 'tìm bảng có cột Email' }] })
      .mockResolvedValueOnce({ action: 'respond', answer: 'Bảng Users có cột Email, có 10 dòng.' });
    mockReactLoop.run.mockResolvedValueOnce({ answer: 'Bảng Users có cột Email', toolCalls: [{ tool: 'get_database_schema', status: 'success' }] });

    await runJob();

    expect(mockSupervisor.decide).toHaveBeenCalledTimes(2);
    expect(mockSupervisor.decide).toHaveBeenNthCalledWith(2, 'có bao nhiêu bảng?', availableAgents, [
      { agent: 'sql_server', task: 'tìm bảng có cột Email', result: 'Bảng Users có cột Email' },
    ], []);
    // chỉ 1 vòng thật sự gọi ReactLoop — vòng 2 Supervisor tự tổng hợp, không delegate tiếp
    expect(mockReactLoop.run).toHaveBeenCalledTimes(1);
    expect(mockMessageClient.updateMessage).toHaveBeenCalledWith({
      id: 'reply-1',
      userId: jobData.botUserId,
      content: 'Bảng Users có cột Email, có 10 dòng.',
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
      .mockResolvedValueOnce({ action: 'respond', answer: 'Có 5 bảng và 3 issue đang mở.' });
    mockReactLoop.run.mockImplementation((dto: { provider: string }) =>
      dto.provider === 'sql_server'
        ? Promise.resolve({ answer: 'Có 5 bảng', toolCalls: [{ tool: 'sql_server.get_database_schema', status: 'success' }] })
        : Promise.resolve({ answer: '3 issue đang mở', toolCalls: [{ tool: 'github.list_issues', status: 'success' }] }),
    );

    await runJob();

    // cả 2 agent chạy trong CÙNG 1 vòng (chỉ 1 lần decide trước khi respond)
    expect(mockSupervisor.decide).toHaveBeenCalledTimes(2);
    expect(mockReactLoop.run).toHaveBeenCalledTimes(2);
    expect(mockReactLoop.run).toHaveBeenCalledWith(expect.objectContaining({ provider: 'sql_server' }));
    expect(mockReactLoop.run).toHaveBeenCalledWith(expect.objectContaining({ provider: 'github' }));
    // round-2 decide() phải thấy CẢ 2 kết quả của vòng 1, không chỉ 1
    const secondCallRounds = mockSupervisor.decide.mock.calls[1][2];
    expect(secondCallRounds).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ agent: 'sql_server', result: 'Có 5 bảng' }),
        expect.objectContaining({ agent: 'github', result: '3 issue đang mở' }),
      ]),
    );
    expect(mockMessageClient.updateMessage).toHaveBeenCalledWith(
      expect.objectContaining({ content: 'Có 5 bảng và 3 issue đang mở.' }),
    );
  });

  it('chains 2 DIFFERENT agents across rounds and aggregates their toolCalls in order (Step 5 — real cross-agent case)', async () => {
    const twoAgents = [
      { provider: 'sql_server', label: 'SQL Server', description: 'desc' },
      { provider: 'github', label: 'GitHub', description: 'desc' },
    ];
    mockSupervisor.getAvailableAgents.mockResolvedValue(twoAgents);
    mockSupervisor.decide
      .mockResolvedValueOnce({ action: 'delegate', delegations: [{ agent: 'sql_server', task: 'tìm khách chi tiêu nhiều nhất' }] })
      .mockResolvedValueOnce({ action: 'delegate', delegations: [{ agent: 'github', task: 'tạo issue nhắc follow-up khách Nguyễn Văn A, 5.000.000đ' }] })
      .mockResolvedValueOnce({ action: 'respond', answer: 'Đã tìm khách VIP và tạo issue GitHub nhắc follow-up.' });
    mockReactLoop.run
      .mockResolvedValueOnce({ answer: 'Khách chi tiêu nhiều nhất: Nguyễn Văn A, 5.000.000đ', toolCalls: [{ tool: 'sql_server.execute_read_only_query', status: 'success' }] })
      .mockResolvedValueOnce({ answer: 'Đã tạo issue #12', toolCalls: [{ tool: 'github.create_issue', status: 'success' }] });

    await runJob();

    // Task của vòng 2 (agent github) phải PHẢN ÁNH ĐÚNG dữ liệu thật vòng 1 trả về
    // (Nguyễn Văn A, 5.000.000đ) — không phải Supervisor tự bịa số liệu khác.
    // `rounds` là mảng mutable bị push tiếp SAU lượt gọi này (vòng 2 tự thêm
    // round của chính nó) — slice đúng số phần tử TẠI THỜI ĐIỂM gọi thay vì
    // so sánh nguyên mảng lúc assert (đã có thêm round 2 trong đó).
    const secondCallArgs = mockSupervisor.decide.mock.calls[1];
    expect(secondCallArgs[0]).toBe('có bao nhiêu bảng?');
    expect(secondCallArgs[1]).toEqual(twoAgents);
    expect((secondCallArgs[2] as unknown[]).slice(0, 1)).toEqual([
      { agent: 'sql_server', task: 'tìm khách chi tiêu nhiều nhất', result: 'Khách chi tiêu nhiều nhất: Nguyễn Văn A, 5.000.000đ' },
    ]);
    expect(mockReactLoop.run).toHaveBeenNthCalledWith(1, expect.objectContaining({ provider: 'sql_server' }));
    expect(mockReactLoop.run).toHaveBeenNthCalledWith(2, expect.objectContaining({ provider: 'github' }));
    // toolCalls gộp từ CẢ 2 agent, đúng thứ tự thời gian, tên đã namespace
    // theo agent (Step 6) nên không lẫn lộn dù tên tool trùng giữa các agent.
    expect(mockMessageClient.updateMessage).toHaveBeenCalledWith({
      id: 'reply-1',
      userId: jobData.botUserId,
      content: 'Đã tìm khách VIP và tạo issue GitHub nhắc follow-up.',
      toolCalls: [
        { tool: 'sql_server.execute_read_only_query', status: 'success' },
        { tool: 'github.create_issue', status: 'success' },
      ],
    });
  });

  it('stops after MAX_SUPERVISOR_ROUNDS and asks Supervisor to synthesize all collected rounds instead of returning the raw last round (Step 9)', async () => {
    mockSupervisor.decide.mockResolvedValue({ action: 'delegate', delegations: [{ agent: 'sql_server', task: 'tiếp tục' }] });
    let call = 0;
    mockReactLoop.run.mockImplementation(() => Promise.resolve({ answer: `kết quả vòng ${++call}`, toolCalls: [] }));
    mockSupervisor.synthesize.mockResolvedValue('Tổng hợp toàn bộ các vòng đã thu thập được.');

    await runJob();

    expect(mockSupervisor.decide).toHaveBeenCalledTimes(ORCHESTRATION_CONSTANTS.MAX_SUPERVISOR_ROUNDS);
    expect(mockReactLoop.run).toHaveBeenCalledTimes(ORCHESTRATION_CONSTANTS.MAX_SUPERVISOR_ROUNDS);
    expect(mockSupervisor.synthesize).toHaveBeenCalledTimes(1);
    const [synthesizePrompt, synthesizeRounds] = mockSupervisor.synthesize.mock.calls[0];
    expect(synthesizePrompt).toBe('có bao nhiêu bảng?');
    expect(synthesizeRounds).toHaveLength(ORCHESTRATION_CONSTANTS.MAX_SUPERVISOR_ROUNDS);
    expect(mockMessageClient.updateMessage).toHaveBeenCalledWith(
      expect.objectContaining({ content: 'Tổng hợp toàn bộ các vòng đã thu thập được.' }),
    );
  });

  it('updates the reply with the raw error message when anything throws', async () => {
    mockSupervisor.decide.mockRejectedValue(new Error('LLM provider is down'));

    await runJob();

    expect(mockMessageClient.updateMessage).toHaveBeenCalledWith({
      id: 'reply-1',
      userId: jobData.botUserId,
      content: '⚠️ Lỗi: LLM provider is down',
    });
    // "done" vẫn phải bắn kể cả khi lỗi — không thì FE treo mãi icon "đang chạy".
    expect(mockAgentStream.emitStep).toHaveBeenCalledWith(expect.anything(), { type: 'done' });
  });

  it('throws for an unsupported job name', async () => {
    await expect(
      processor.process({ name: 'unknown_job', data: jobData } as unknown as Job<IProcessAiTriggerJobData, void, EJobName>),
    ).rejects.toThrow('Job name unknown_job is not supported');
  });
});
