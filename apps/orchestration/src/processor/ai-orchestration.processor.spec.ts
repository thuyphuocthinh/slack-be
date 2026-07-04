import { Test, TestingModule } from '@nestjs/testing';
import { Job } from 'bullmq';
import {
  EJobName,
  EQueueName,
  IProcessAiTriggerJobData,
  IProcessApprovalJobData,
  QueueService,
} from '@slack/queue';
import { ORCHESTRATION_CONSTANTS } from '@slack/constants';
import { AiOrchestrationProcessor } from './ai-orchestration.processor';
import { MessageClientService } from '../message-client.service';
import { ReactLoopService } from '../llm/react-loop.service';
import { SupervisorService } from '../llm/supervisor.service';
import { AgentStreamService } from '../socket/agent-stream.service';
import { CheckpointService } from '../checkpoint/checkpoint.service';
import { ApprovalRequiredError } from '../llm/approval-required.error';
import { McpClientService } from '../mcp/mcp-client.service';
import { OrchestrationCheckpointStatus } from '../entity/orchestration-checkpoint.entity';

// ai-orchestration.processor.ts import ReactLoopService (dù đã mock qua DI ở
// dưới) — file thật của nó vẫn import @slack/common ở module scope, kéo theo
// "nanoid" (ESM-only) mà jest không transform được. Mock thẳng barrel, cùng
// convention đã dùng ở auth.service.spec.ts.
jest.mock('@slack/common', () => ({ extractTextFromMcpResult: jest.fn() }));
import { extractTextFromMcpResult } from '@slack/common';

describe('AiOrchestrationProcessor', () => {
  let processor: AiOrchestrationProcessor;

  const mockMessageClient = {
    createMessage: jest.fn(),
    updateMessage: jest.fn(),
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
  const mockCheckpoint = {
    create: jest.fn(),
    findPendingByReplyMessageId: jest.fn(),
    findById: jest.fn(),
    claim: jest.fn(),
  };
  const mockMcpClient = { callTool: jest.fn() };
  const mockQueueService = { addJob: jest.fn() };

  const jobData: IProcessAiTriggerJobData = {
    userId: 'user-1',
    channelId: 'channel-1',
    workspaceId: 'workspace-1',
    messageId: 'trigger-msg-1',
    botUserId: 'bot-1',
    channelType: 'direct',
  };

  const availableAgents = [
    { provider: 'sql_server', label: 'SQL Server', description: 'desc' },
  ];

  beforeEach(async () => {
    mockMessageClient.createMessage.mockResolvedValue({ id: 'reply-1' });
    mockMessageClient.getMessageText.mockResolvedValue('có bao nhiêu bảng?');
    mockMessageClient.getRecentHistory.mockResolvedValue([]);
    mockSupervisor.getAvailableAgents.mockResolvedValue(availableAgents);
    mockCheckpoint.claim.mockResolvedValue({ claimed: true });
    mockCheckpoint.create.mockResolvedValue(undefined);
    mockQueueService.addJob.mockResolvedValue({ id: 'job-1' });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AiOrchestrationProcessor,
        { provide: MessageClientService, useValue: mockMessageClient },
        { provide: ReactLoopService, useValue: mockReactLoop },
        { provide: SupervisorService, useValue: mockSupervisor },
        { provide: AgentStreamService, useValue: mockAgentStream },
        { provide: CheckpointService, useValue: mockCheckpoint },
        { provide: McpClientService, useValue: mockMcpClient },
        { provide: QueueService, useValue: mockQueueService },
      ],
    }).compile();

    processor = module.get<AiOrchestrationProcessor>(AiOrchestrationProcessor);
  });

  afterEach(() => jest.clearAllMocks());

  const runJob = (data: IProcessAiTriggerJobData = jobData) =>
    processor.process({ name: EJobName.PROCESS_AI_TRIGGER, data } as Job<
      IProcessAiTriggerJobData,
      void,
      EJobName
    >);

  it('creates a placeholder message before doing anything else', async () => {
    mockSupervisor.decide.mockResolvedValue({
      action: 'respond',
      answer: 'Chào bạn!',
    });

    await runJob();

    expect(mockMessageClient.createMessage).toHaveBeenCalledWith({
      channelId: jobData.channelId,
      senderId: jobData.botUserId,
      content: '🤖 Đang xử lý...',
    });
  });

  it('updates the reply with the Supervisor answer directly when action is "respond" — no ReAct loop involved', async () => {
    mockSupervisor.decide.mockResolvedValue({
      action: 'respond',
      answer: 'Chào bạn!',
    });

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
      {
        userId: jobData.userId,
        channelId: jobData.channelId,
        messageId: 'reply-1',
        channelType: jobData.channelType,
      },
      { type: 'done' },
    );
  });

  it('falls back to a default message when Supervisor responds with action="respond" but no answer text', async () => {
    mockSupervisor.decide.mockResolvedValue({ action: 'respond' });

    await runJob();

    expect(mockMessageClient.updateMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        content: 'Xin lỗi, mình chưa có câu trả lời phù hợp.',
      }),
    );
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

    await runJob();

    expect(mockReactLoop.run).toHaveBeenCalledTimes(1);
    expect(mockReactLoop.run).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: 'đếm đơn Completed' }),
    );
  });

  it('delegates to ReactLoopService with the Supervisor-authored task when action is "delegate"', async () => {
    // Vòng 1: delegate. Vòng 2: Supervisor thấy đủ dữ liệu, respond luôn —
    // dùng mockResolvedValueOnce cho từng vòng vì decide() giờ được gọi lặp
    // lại (Step 3), không còn đúng 1 lần/turn như trước.
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
    expect(mockAgentStream.emitStep).toHaveBeenCalledWith(expect.anything(), {
      type: 'done',
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

    await runJob();

    expect(mockReactLoop.run).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: 'có bao nhiêu bảng?' }),
    );
  });

  it('falls back to a safe message and skips ReactLoopService when Supervisor delegates to an agent outside the available list', async () => {
    // "notion" không có trong availableAgents
    mockSupervisor.decide.mockResolvedValue({
      action: 'delegate',
      delegations: [{ agent: 'notion', task: 'đọc trang' }],
    });

    await runJob();

    expect(mockReactLoop.run).not.toHaveBeenCalled();
    expect(mockMessageClient.updateMessage).toHaveBeenCalledWith({
      id: 'reply-1',
      userId: jobData.botUserId,
      content: expect.stringContaining('Settings'),
    });
  });

  it('treats a missing "delegations" field on action="delegate" the same as an empty array, instead of throwing', async () => {
    mockSupervisor.decide.mockResolvedValue({ action: 'delegate' });

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

    await runJob();

    // Kết quả sql_server KHÔNG bị mất dù github ném lỗi trong CÙNG Promise.all
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
    // Lỗi 1 nhánh không làm sập cả turn — vẫn respond bình thường ở vòng 2
    expect(mockMessageClient.updateMessage).toHaveBeenCalledWith(
      expect.objectContaining({ content: 'Đã có 5 bảng, GitHub thì lỗi.' }),
    );
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

    await runJob();

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

    await runJob();

    // cả 2 agent chạy trong CÙNG 1 vòng (chỉ 1 lần decide trước khi respond)
    expect(mockSupervisor.decide).toHaveBeenCalledTimes(2);
    expect(mockReactLoop.run).toHaveBeenCalledTimes(2);
    expect(mockReactLoop.run).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'sql_server' }),
    );
    expect(mockReactLoop.run).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'github' }),
    );
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
      {
        agent: 'sql_server',
        task: 'tìm khách chi tiêu nhiều nhất',
        result: 'Khách chi tiêu nhiều nhất: Nguyễn Văn A, 5.000.000đ',
      },
    ]);
    expect(mockReactLoop.run).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ provider: 'sql_server' }),
    );
    expect(mockReactLoop.run).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ provider: 'github' }),
    );
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

    await runJob();

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
    expect(mockMessageClient.updateMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        content: 'Tổng hợp toàn bộ các vòng đã thu thập được.',
      }),
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
    expect(mockAgentStream.emitStep).toHaveBeenCalledWith(expect.anything(), {
      type: 'done',
    });
  });

  it('throws for an unsupported job name', async () => {
    await expect(
      processor.process({
        name: 'unknown_job',
        data: jobData,
      } as unknown as Job<IProcessAiTriggerJobData, void, EJobName>),
    ).rejects.toThrow('Job name unknown_job is not supported');
  });

  it('starts a new turn even when the channel already has a pending checkpoint (Giai đoạn 3 — HITL, Step 8 revised: turns run fully concurrently, never dropped)', async () => {
    mockCheckpoint.findPendingByReplyMessageId.mockResolvedValue({
      id: 'other-checkpoint',
      userId: 'user-2',
    });
    mockSupervisor.decide.mockResolvedValue({
      action: 'respond',
      answer: 'Chào bạn!',
    });

    await runJob();

    expect(mockSupervisor.decide).toHaveBeenCalledTimes(1);
    expect(mockMessageClient.updateMessage).toHaveBeenCalledWith(
      expect.objectContaining({ content: 'Chào bạn!' }),
    );
  });

  describe('pauseForApproval (Giai đoạn 3 — HITL, Step 3)', () => {
    it('creates a NEW approval_request message, saves a checkpoint, and points the placeholder reply at it', async () => {
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
      mockReactLoop.run.mockRejectedValue(
        new ApprovalRequiredError(pendingTool),
      );
      mockMessageClient.createMessage
        .mockResolvedValueOnce({ id: 'reply-1' }) // placeholder "Đang xử lý..."
        .mockResolvedValueOnce({ id: 'approval-msg-1' }); // approval_request

      await runJob();

      expect(mockMessageClient.createMessage).toHaveBeenNthCalledWith(2, {
        channelId: jobData.channelId,
        senderId: jobData.botUserId,
        // mcpClient.callTool không được mock ở test này -> không đếm được -> fallback cảnh báo chung (Step 6)
        content: {
          type: 'approval_request',
          tool: pendingTool,
          status: 'pending',
          preview:
            'Không ước lượng được ảnh hưởng, cân nhắc kỹ trước khi duyệt.',
          triggerUserId: jobData.userId,
        },
      });
      expect(mockCheckpoint.create).toHaveBeenCalledWith({
        replyMessageId: 'approval-msg-1',
        userId: jobData.userId,
        botUserId: jobData.botUserId,
        channelId: jobData.channelId,
        workspaceId: jobData.workspaceId,
        channelType: jobData.channelType,
        originalPrompt: 'có bao nhiêu bảng?',
        pendingTool,
        pendingTask: 'cập nhật status đơn OrderId=1',
        roundsSoFar: [],
        history: [],
      });
      // Placeholder "Đang xử lý..." được cập nhật thành pointer, KHÔNG phải nội dung approval_request
      expect(mockMessageClient.updateMessage).toHaveBeenCalledWith({
        id: 'reply-1',
        userId: jobData.botUserId,
        content:
          '⏸️ Cần bạn duyệt 1 hành động trước khi tiếp tục — xem tin nhắn bên dưới.',
      });
      // "done" vẫn phải bắn — turn coi như tạm dừng thành công, không phải lỗi
      expect(mockAgentStream.emitStep).toHaveBeenCalledWith(expect.anything(), {
        type: 'done',
      });
    });

    it('attaches the pending tool (and any toolCalls already run for real this turn) to the approval_request message, so the timeline renders it like any other bot message', async () => {
      mockSupervisor.decide.mockResolvedValue({
        action: 'delegate',
        delegations: [{ agent: 'sql_server', task: 'xoá đơn OrderId=1' }],
      });
      const pendingTool = {
        provider: 'sql_server',
        name: 'execute_write_query',
        args: { query: 'DELETE FROM Orders WHERE OrderId=1' },
      };
      const priorToolCalls = [
        { tool: 'sql_server.get_database_schema', status: 'success' as const },
      ];
      mockReactLoop.run.mockRejectedValue(
        new ApprovalRequiredError(pendingTool, priorToolCalls),
      );
      mockMessageClient.createMessage
        .mockResolvedValueOnce({ id: 'reply-1' })
        .mockResolvedValueOnce({ id: 'approval-msg-1' });

      await runJob();

      const approvalContent =
        mockMessageClient.createMessage.mock.calls[1][0].content;
      expect(mockMessageClient.updateMessage).toHaveBeenCalledWith({
        id: 'approval-msg-1',
        userId: jobData.botUserId,
        content: approvalContent,
        toolCalls: [
          ...priorToolCalls,
          {
            tool: 'sql_server.execute_write_query',
            status: 'awaiting_approval',
          },
        ],
      });
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

      await runJob();

      // reactLoop.run() được gọi (nó tự chặn tool bên trong trước khi thực thi
      // thật) đúng 1 lần — không có vòng Supervisor tiếp theo nào chạy tiếp.
      expect(mockReactLoop.run).toHaveBeenCalledTimes(1);
      expect(mockSupervisor.decide).toHaveBeenCalledTimes(1);
    });

    it("keeps a sibling delegation's successful result in the checkpoint when it completes in the SAME round as one needing approval", async () => {
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
      mockMessageClient.createMessage
        .mockResolvedValueOnce({ id: 'reply-1' })
        .mockResolvedValueOnce({ id: 'approval-msg-1' });

      await runJob();

      const checkpointArg = mockCheckpoint.create.mock.calls[0][0];
      expect(checkpointArg.roundsSoFar).toEqual([
        { agent: 'github', task: 'liệt kê issue', result: '3 issue đang mở' },
      ]);
      // toolCalls của agent anh em đã chạy xong vẫn hiện trong reply, không bị mất
      expect(mockMessageClient.updateMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          toolCalls: [{ tool: 'github.list_issues', status: 'success' }],
        }),
      );
    });

    it('keeps the toolCalls that already ran for real BEFORE the blocked one, in the SAME ReactLoop turn', async () => {
      mockSupervisor.decide.mockResolvedValue({
        action: 'delegate',
        delegations: [{ agent: 'sql_server', task: 'xoá đơn OrderId=1' }],
      });
      const pendingTool = {
        provider: 'sql_server',
        name: 'execute_write_query',
        args: { query: 'DELETE FROM Orders WHERE OrderId=1' },
      };
      const priorToolCalls = [
        {
          tool: 'sql_server.get_database_schema',
          status: 'success' as const,
          resultPreview: '{...}',
        },
      ];
      mockReactLoop.run.mockRejectedValue(
        new ApprovalRequiredError(pendingTool, priorToolCalls),
      );
      mockMessageClient.createMessage
        .mockResolvedValueOnce({ id: 'reply-1' })
        .mockResolvedValueOnce({ id: 'approval-msg-1' });

      await runJob();

      expect(mockMessageClient.updateMessage).toHaveBeenCalledWith(
        expect.objectContaining({ toolCalls: priorToolCalls }),
      );
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
      const sqlTool = {
        provider: 'sql_server',
        name: 'execute_write_query',
        args: {},
      };
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
      mockMessageClient.createMessage
        .mockResolvedValueOnce({ id: 'reply-1' })
        .mockResolvedValueOnce({ id: 'approval-msg-1' });

      await runJob();

      expect(mockCheckpoint.create).toHaveBeenCalledWith(
        expect.objectContaining({ pendingTool: sqlTool }),
      );
      const approvalUpdateCall =
        mockMessageClient.updateMessage.mock.calls.find(
          (call) => call[0].id === 'approval-msg-1',
        );
      expect(approvalUpdateCall[0].toolCalls).toEqual(
        expect.arrayContaining([
          { tool: 'sql_server.get_database_schema', status: 'success' },
          { tool: 'github.list_issues', status: 'success' },
        ]),
      );
    });

    it('does not block the approval flow when attaching the toolCalls trace itself fails (cosmetic only)', async () => {
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
      mockMessageClient.createMessage
        .mockResolvedValueOnce({ id: 'reply-1' })
        .mockResolvedValueOnce({ id: 'approval-msg-1' });
      mockMessageClient.updateMessage.mockRejectedValueOnce(
        new Error('message service unreachable'),
      );

      await expect(runJob()).resolves.toBeUndefined();

      // Checkpoint vẫn được tạo bình thường dù gắn toolCalls trace lỗi (chỉ mất hiển thị, không chặn luồng chính)
      expect(mockCheckpoint.create).toHaveBeenCalled();
    });

    it('edits the orphaned approval message and rethrows when checkpoint.create() fails AFTER the message was already created', async () => {
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
      mockMessageClient.createMessage
        .mockResolvedValueOnce({ id: 'reply-1' })
        .mockResolvedValueOnce({ id: 'approval-msg-1' });
      mockCheckpoint.create.mockRejectedValue(
        new Error('connect ECONNREFUSED'),
      );

      await runJob();

      // Message "approval_request" mồ côi (không có checkpoint) được sửa lại
      // thành lỗi rõ ràng, KHÔNG để treo mãi "cần duyệt" mà bấm gì cũng vô ích.
      expect(mockMessageClient.updateMessage).toHaveBeenCalledWith({
        id: 'approval-msg-1',
        userId: jobData.botUserId,
        content: '⚠️ Không thể tạo yêu cầu duyệt, vui lòng hỏi lại.',
      });
      // Placeholder "Đang xử lý..." cũng phải phản ánh lỗi (qua catch chung ở handleAiTrigger)
      expect(mockMessageClient.updateMessage).toHaveBeenCalledWith({
        id: 'reply-1',
        userId: jobData.botUserId,
        content: '⚠️ Lỗi: connect ECONNREFUSED',
      });
      expect(mockAgentStream.emitStep).toHaveBeenCalledWith(expect.anything(), {
        type: 'done',
      });
    });
  });

  describe('buildRiskPreview (Giai đoạn 3 — HITL, Step 6)', () => {
    const setupPendingWrite = (query: string) => {
      mockSupervisor.decide.mockResolvedValue({
        action: 'delegate',
        delegations: [{ agent: 'sql_server', task: 'task' }],
      });
      mockReactLoop.run.mockRejectedValue(
        new ApprovalRequiredError({
          provider: 'sql_server',
          name: 'execute_write_query',
          args: { query },
        }),
      );
      mockMessageClient.createMessage
        .mockResolvedValueOnce({ id: 'reply-1' })
        .mockResolvedValueOnce({ id: 'approval-msg-1' });
    };

    const getPreview = () =>
      (
        mockMessageClient.createMessage.mock.calls[1][0].content as {
          preview: string;
        }
      ).preview;

    it('runs a read-only COUNT derived from the WHERE clause and embeds the row estimate', async () => {
      setupPendingWrite("UPDATE Orders SET Status='Completed' WHERE OrderId=1");
      mockMcpClient.callTool.mockResolvedValue({
        content: [{ type: 'text', text: '[{"affectedRows":12}]' }],
      });
      (extractTextFromMcpResult as jest.Mock).mockReturnValue(
        '[{"affectedRows":12}]',
      );

      await runJob();

      expect(mockMcpClient.callTool).toHaveBeenCalledWith({
        provider: 'sql_server',
        name: 'execute_read_only_query',
        args: {
          query: 'SELECT COUNT(*) AS affectedRows FROM Orders WHERE OrderId=1',
        },
        ownerId: jobData.userId,
      });
      expect(getPreview()).toBe('Sẽ ảnh hưởng ~12 dòng.');
    });

    it('warns about the whole table when DELETE has no WHERE clause, but still counts it for real', async () => {
      setupPendingWrite('DELETE FROM Orders');
      mockMcpClient.callTool.mockResolvedValue({
        content: [{ type: 'text', text: '[{"affectedRows":9999}]' }],
      });
      (extractTextFromMcpResult as jest.Mock).mockReturnValue(
        '[{"affectedRows":9999}]',
      );

      await runJob();

      expect(mockMcpClient.callTool).toHaveBeenCalledWith(
        expect.objectContaining({
          args: { query: 'SELECT COUNT(*) AS affectedRows FROM Orders' },
        }),
      );
      expect(getPreview()).toContain('KHÔNG có mệnh đề WHERE');
      expect(getPreview()).toContain('9999');
    });

    it('falls back to a generic warning for execute_stored_procedure (cannot estimate an arbitrary SP), without running a COUNT query', async () => {
      mockSupervisor.decide.mockResolvedValue({
        action: 'delegate',
        delegations: [{ agent: 'sql_server', task: 'task' }],
      });
      mockReactLoop.run.mockRejectedValue(
        new ApprovalRequiredError({
          provider: 'sql_server',
          name: 'execute_stored_procedure',
          args: { query: "EXEC sp_x @a='1'" },
        }),
      );
      mockMessageClient.createMessage
        .mockResolvedValueOnce({ id: 'reply-1' })
        .mockResolvedValueOnce({ id: 'approval-msg-1' });

      await runJob();

      expect(mockMcpClient.callTool).not.toHaveBeenCalled();
      expect(getPreview()).toBe(
        'Không ước lượng được ảnh hưởng, cân nhắc kỹ trước khi duyệt.',
      );
    });

    it('falls back to a generic warning for other domains (VD github.create_issue), without running a COUNT query', async () => {
      mockSupervisor.getAvailableAgents.mockResolvedValue([
        { provider: 'github', label: 'GitHub', description: 'desc' },
      ]);
      mockSupervisor.decide.mockResolvedValue({
        action: 'delegate',
        delegations: [{ agent: 'github', task: 'task' }],
      });
      mockReactLoop.run.mockRejectedValue(
        new ApprovalRequiredError({
          provider: 'github',
          name: 'create_issue',
          args: { title: 'Bug' },
        }),
      );
      mockMessageClient.createMessage
        .mockResolvedValueOnce({ id: 'reply-1' })
        .mockResolvedValueOnce({ id: 'approval-msg-1' });

      await runJob();

      expect(mockMcpClient.callTool).not.toHaveBeenCalled();
      expect(getPreview()).toBe(
        'Không ước lượng được ảnh hưởng, cân nhắc kỹ trước khi duyệt.',
      );
    });

    it('falls back to a generic warning if the COUNT query itself fails, instead of blocking the approval flow', async () => {
      setupPendingWrite('DELETE FROM Orders WHERE OrderId=1');
      mockMcpClient.callTool.mockRejectedValue(
        new Error('connect ECONNREFUSED'),
      );

      await runJob();

      expect(getPreview()).toBe(
        'Không ước lượng được ảnh hưởng, cân nhắc kỹ trước khi duyệt.',
      );
    });

    it('falls back to a generic warning when the write query cannot be parsed (VD INSERT)', async () => {
      setupPendingWrite("INSERT INTO Orders (Status) VALUES ('Pending')");

      await runJob();

      expect(mockMcpClient.callTool).not.toHaveBeenCalled();
      expect(getPreview()).toBe(
        'Không ước lượng được ảnh hưởng, cân nhắc kỹ trước khi duyệt.',
      );
    });
  });

  describe('resolveApproval (Giai đoạn 3 — HITL, Step 5)', () => {
    const checkpoint = {
      id: 'checkpoint-1',
      replyMessageId: 'approval-msg-1',
      userId: 'user-1',
      botUserId: 'bot-1',
      channelId: 'channel-1',
      workspaceId: 'workspace-1',
      channelType: 'direct',
      originalPrompt: 'cập nhật status đơn OrderId=1 thành Completed',
      pendingTool: {
        provider: 'sql_server',
        name: 'execute_write_query',
        args: { query: "UPDATE Orders SET Status='Completed' WHERE OrderId=1" },
      },
      pendingTask: 'cập nhật status đơn OrderId=1',
      roundsSoFar: [
        {
          agent: 'sql_server',
          task: 'tìm đơn OrderId=1',
          result: 'Đơn OrderId=1 đang Pending',
        },
      ],
      history: [],
    };

    it('reject: marks the checkpoint rejected, edits the message, does NOT run the tool or ReactLoop', async () => {
      mockCheckpoint.findPendingByReplyMessageId.mockResolvedValue(checkpoint);

      await processor.resolveApproval({
        userId: 'user-1',
        messageId: 'approval-msg-1',
        action: 'reject',
      });

      expect(mockCheckpoint.claim).toHaveBeenCalledWith({
        id: 'checkpoint-1',
        toStatus: OrchestrationCheckpointStatus.REJECTED,
      });
      expect(mockMessageClient.updateMessage).toHaveBeenCalledWith({
        id: 'approval-msg-1',
        userId: 'bot-1',
        content: '❌ Đã huỷ theo yêu cầu.',
      });
      expect(mockMcpClient.callTool).not.toHaveBeenCalled();
      expect(mockReactLoop.run).not.toHaveBeenCalled();
      expect(mockAgentStream.emitStep).toHaveBeenCalledWith(
        {
          userId: 'user-1',
          channelId: 'channel-1',
          messageId: 'approval-msg-1',
          channelType: 'direct',
        },
        { type: 'done' },
      );
    });

    it('approve: claims the checkpoint then enqueues a background job instead of running the tool inline (fast HTTP response)', async () => {
      mockCheckpoint.findPendingByReplyMessageId.mockResolvedValue(checkpoint);

      await processor.resolveApproval({
        userId: 'user-1',
        messageId: 'approval-msg-1',
        action: 'approve',
      });

      expect(mockCheckpoint.claim).toHaveBeenCalledWith({
        id: 'checkpoint-1',
        toStatus: OrchestrationCheckpointStatus.APPROVED,
      });
      // attempts:1 — mcpClient.callTool() không idempotent, không được để queue tự retry chạy lại tool THẬT lần 2.
      expect(mockQueueService.addJob).toHaveBeenCalledWith(
        EQueueName.AI_ORCHESTRATION_QUEUE,
        EJobName.PROCESS_APPROVAL,
        { checkpointId: 'checkpoint-1', userId: 'user-1' },
        { attempts: 1 },
      );
      expect(mockMcpClient.callTool).not.toHaveBeenCalled();
      expect(mockReactLoop.run).not.toHaveBeenCalled();
      expect(mockMessageClient.updateMessage).not.toHaveBeenCalled();
    });

    it('throws CHECKPOINT_NOT_FOUND when there is no pending checkpoint for this message', async () => {
      mockCheckpoint.findPendingByReplyMessageId.mockResolvedValue(null);

      await expect(
        processor.resolveApproval({
          userId: 'user-1',
          messageId: 'unknown-msg',
          action: 'approve',
        }),
      ).rejects.toThrow();
      expect(mockCheckpoint.claim).not.toHaveBeenCalled();
    });

    it('throws CHECKPOINT_FORBIDDEN when the requester is not the user who triggered the turn', async () => {
      mockCheckpoint.findPendingByReplyMessageId.mockResolvedValue(checkpoint);

      await expect(
        processor.resolveApproval({
          userId: 'some-other-user',
          messageId: 'approval-msg-1',
          action: 'approve',
        }),
      ).rejects.toThrow();
      expect(mockCheckpoint.claim).not.toHaveBeenCalled();
      expect(mockMcpClient.callTool).not.toHaveBeenCalled();
    });

    it('throws CHECKPOINT_ALREADY_RESOLVED and never runs the tool when another request already claimed it first (double-click / 2 tabs)', async () => {
      mockCheckpoint.findPendingByReplyMessageId.mockResolvedValue(checkpoint);
      mockCheckpoint.claim.mockResolvedValue({ claimed: false });

      await expect(
        processor.resolveApproval({
          userId: 'user-1',
          messageId: 'approval-msg-1',
          action: 'approve',
        }),
      ).rejects.toThrow();
      expect(mockQueueService.addJob).not.toHaveBeenCalled();
      expect(mockMcpClient.callTool).not.toHaveBeenCalled();
      expect(mockReactLoop.run).not.toHaveBeenCalled();
      expect(mockMessageClient.updateMessage).not.toHaveBeenCalled();
    });
  });

  describe('processApprovalJob (Giai đoạn 3 — HITL, Step 5 — thực thi nền qua queue)', () => {
    const checkpoint = {
      id: 'checkpoint-1',
      replyMessageId: 'approval-msg-1',
      userId: 'user-1',
      botUserId: 'bot-1',
      channelId: 'channel-1',
      workspaceId: 'workspace-1',
      channelType: 'direct',
      originalPrompt: 'cập nhật status đơn OrderId=1 thành Completed',
      pendingTool: {
        provider: 'sql_server',
        name: 'execute_write_query',
        args: { query: "UPDATE Orders SET Status='Completed' WHERE OrderId=1" },
      },
      pendingTask: 'cập nhật status đơn OrderId=1',
      roundsSoFar: [
        {
          agent: 'sql_server',
          task: 'tìm đơn OrderId=1',
          result: 'Đơn OrderId=1 đang Pending',
        },
      ],
      history: [],
    };

    const runApprovalJob = (
      data: IProcessApprovalJobData = {
        checkpointId: 'checkpoint-1',
        userId: 'user-1',
      },
    ) =>
      processor.process({ name: EJobName.PROCESS_APPROVAL, data } as Job<
        IProcessApprovalJobData,
        void,
        EJobName
      >);

    it('runs the real tool, resumes ReactLoop with the result folded in, synthesizes with prior rounds, and updates the message', async () => {
      mockCheckpoint.findById.mockResolvedValue(checkpoint);
      mockMcpClient.callTool.mockResolvedValue({
        content: [{ type: 'text', text: 'raw mcp result' }],
      });
      (extractTextFromMcpResult as jest.Mock).mockReturnValue(
        '1 dòng đã được cập nhật.',
      );
      mockReactLoop.run.mockResolvedValue({
        answer: 'Đơn OrderId=1 đã Completed.',
        toolCalls: [
          { tool: 'sql_server.execute_write_query', status: 'success' },
        ],
      });
      mockSupervisor.synthesize.mockResolvedValue(
        'Đã cập nhật đơn OrderId=1 thành Completed.',
      );

      await runApprovalJob();

      expect(mockCheckpoint.findById).toHaveBeenCalledWith({
        id: 'checkpoint-1',
      });
      expect(mockMcpClient.callTool).toHaveBeenCalledWith({
        provider: 'sql_server',
        name: 'execute_write_query',
        args: { query: "UPDATE Orders SET Status='Completed' WHERE OrderId=1" },
        ownerId: 'user-1',
      });

      const resumeCallArg = mockReactLoop.run.mock.calls[0][0];
      expect(resumeCallArg.provider).toBe('sql_server');
      expect(resumeCallArg.prompt).toContain('1 dòng đã được cập nhật.');
      expect(resumeCallArg.history).toEqual([]);

      expect(mockSupervisor.synthesize).toHaveBeenCalledWith(
        checkpoint.originalPrompt,
        [
          ...checkpoint.roundsSoFar,
          {
            agent: 'sql_server',
            task: 'cập nhật status đơn OrderId=1',
            result: 'Đơn OrderId=1 đã Completed.',
          },
        ],
      );
      expect(mockMessageClient.updateMessage).toHaveBeenCalledWith({
        id: 'approval-msg-1',
        userId: 'bot-1',
        content: 'Đã cập nhật đơn OrderId=1 thành Completed.',
        toolCalls: [
          { tool: 'sql_server.execute_write_query', status: 'success' },
        ],
      });
      expect(mockAgentStream.emitStep).toHaveBeenCalledWith(expect.anything(), {
        type: 'done',
      });
    });

    it('sends toolCalls=undefined (not an empty array) when the resumed ReactLoop needed no further tool calls', async () => {
      mockCheckpoint.findById.mockResolvedValue(checkpoint);
      mockMcpClient.callTool.mockResolvedValue({
        content: [{ type: 'text', text: 'raw mcp result' }],
      });
      (extractTextFromMcpResult as jest.Mock).mockReturnValue(
        '1 dòng đã được cập nhật.',
      );
      mockReactLoop.run.mockResolvedValue({
        answer: 'Đơn OrderId=1 đã Completed.',
        toolCalls: [],
      });
      mockSupervisor.synthesize.mockResolvedValue(
        'Đã cập nhật đơn OrderId=1 thành Completed.',
      );

      await runApprovalJob();

      expect(mockMessageClient.updateMessage).toHaveBeenCalledWith({
        id: 'approval-msg-1',
        userId: 'bot-1',
        content: 'Đã cập nhật đơn OrderId=1 thành Completed.',
        toolCalls: undefined,
      });
    });

    it('falls back to the raw error message if running the real tool (or resume) fails, but still emits done', async () => {
      mockCheckpoint.findById.mockResolvedValue(checkpoint);
      mockMcpClient.callTool.mockRejectedValue(
        new Error('connect ECONNREFUSED'),
      );

      await runApprovalJob();

      expect(mockMessageClient.updateMessage).toHaveBeenCalledWith({
        id: 'approval-msg-1',
        userId: 'bot-1',
        content: '⚠️ Lỗi: connect ECONNREFUSED',
      });
      expect(mockAgentStream.emitStep).toHaveBeenCalledWith(expect.anything(), {
        type: 'done',
      });
    });

    it('does not throw (and still emits done) when even the error-fallback updateMessage() call itself fails', async () => {
      mockCheckpoint.findById.mockResolvedValue(checkpoint);
      mockMcpClient.callTool.mockRejectedValue(
        new Error('connect ECONNREFUSED'),
      );
      mockMessageClient.updateMessage.mockRejectedValue(
        new Error('message service unreachable'),
      );

      await expect(runApprovalJob()).resolves.toBeUndefined();

      expect(mockAgentStream.emitStep).toHaveBeenCalledWith(expect.anything(), {
        type: 'done',
      });
    });

    it('logs and returns quietly (does not throw) when the checkpoint can no longer be found', async () => {
      mockCheckpoint.findById.mockResolvedValue(null);

      await expect(runApprovalJob()).resolves.toBeUndefined();

      expect(mockMcpClient.callTool).not.toHaveBeenCalled();
      expect(mockMessageClient.updateMessage).not.toHaveBeenCalled();
    });
  });
});
