import { Test, TestingModule } from '@nestjs/testing';
import { IProcessAiTriggerJobData } from '@slack/queue';
import { CheckpointPauseService } from './checkpoint-pause.service';
import { MessageClientService } from '../message-client.service';
import { CheckpointService } from '../checkpoint/checkpoint.service';
import { McpClientService } from '../mcp/mcp-client.service';
import { ApprovalRequiredDelegateResult } from './orchestration-answer.types';

// checkpoint-pause.service.ts import @slack/common ở module scope (extractTextFromMcpResult)
// — mock thẳng barrel để tránh kéo theo "nanoid" (ESM-only) mà jest không transform được.
jest.mock('@slack/common', () => ({ extractTextFromMcpResult: jest.fn() }));
import { extractTextFromMcpResult } from '@slack/common';

describe('CheckpointPauseService', () => {
  let service: CheckpointPauseService;

  const mockMessageClient = {
    createMessage: jest.fn(),
    updateMessage: jest.fn(),
  };
  const mockCheckpoint = { create: jest.fn() };
  const mockMcpClient = { callTool: jest.fn() };

  const data: IProcessAiTriggerJobData = {
    userId: 'user-1',
    channelId: 'channel-1',
    workspaceId: 'workspace-1',
    messageId: 'trigger-msg-1',
    botUserId: 'bot-1',
    channelType: 'direct',
  };
  const originalPrompt = 'cập nhật status đơn OrderId=1 thành Completed';

  beforeEach(async () => {
    mockMessageClient.createMessage.mockResolvedValue({ id: 'approval-msg-1' });
    mockMessageClient.updateMessage.mockResolvedValue(undefined);
    mockCheckpoint.create.mockResolvedValue(undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CheckpointPauseService,
        { provide: MessageClientService, useValue: mockMessageClient },
        { provide: CheckpointService, useValue: mockCheckpoint },
        { provide: McpClientService, useValue: mockMcpClient },
      ],
    }).compile();

    service = module.get<CheckpointPauseService>(CheckpointPauseService);
  });

  afterEach(() => jest.clearAllMocks());

  const buildApprovalNeeded = (
    overrides: Partial<ApprovalRequiredDelegateResult['approvalRequired']> = {},
    task = 'cập nhật status đơn OrderId=1',
    toolCalls: ApprovalRequiredDelegateResult['toolCalls'] = [],
  ): ApprovalRequiredDelegateResult => ({
    approvalRequired: {
      provider: 'sql_server',
      name: 'execute_write_query',
      args: { query: "UPDATE Orders SET Status='Completed' WHERE OrderId=1" },
      ...overrides,
    },
    task,
    toolCalls,
  });

  describe('pauseForApproval', () => {
    it('creates a NEW approval_request message, saves a checkpoint with the rounds/history passed in, and returns a pause answer', async () => {
      const approvalNeeded = buildApprovalNeeded();

      const result = await service.pauseForApproval(
        data,
        originalPrompt,
        [],
        [],
        [],
        approvalNeeded,
      );

      expect(mockMessageClient.createMessage).toHaveBeenCalledWith({
        channelId: data.channelId,
        senderId: data.botUserId,
        content: {
          type: 'approval_request',
          tool: approvalNeeded.approvalRequired,
          status: 'pending',
          // mcpClient.callTool không mock ở test này -> không đếm được -> fallback hiện raw args
          preview: expect.stringContaining(
            'Sẽ gọi "sql_server.execute_write_query" với tham số:',
          ),
          triggerUserId: data.userId,
        },
      });
      expect(mockCheckpoint.create).toHaveBeenCalledWith({
        replyMessageId: 'approval-msg-1',
        userId: data.userId,
        botUserId: data.botUserId,
        channelId: data.channelId,
        workspaceId: data.workspaceId,
        channelType: data.channelType,
        originalPrompt,
        pendingTool: approvalNeeded.approvalRequired,
        pendingTask: approvalNeeded.task,
        roundsSoFar: [],
        history: [],
      });
      expect(result).toEqual({
        content:
          '⏸️ Cần bạn duyệt 1 hành động trước khi tiếp tục — xem tin nhắn bên dưới.',
        toolCalls: undefined,
      });
    });

    it('persists the rounds/history/toolCalls passed in as-is (chained checkpoint case)', async () => {
      const approvalNeeded = buildApprovalNeeded();
      const roundsSoFar = [
        { agent: 'sql_server', task: 'tìm đơn', result: 'Đơn Pending' },
      ];
      const history = [{ role: 'user' as const, text: 'hi' }];
      const priorToolCalls = [
        { tool: 'sql_server.get_database_schema', status: 'success' as const },
      ];

      await service.pauseForApproval(
        data,
        originalPrompt,
        roundsSoFar,
        priorToolCalls,
        history,
        approvalNeeded,
      );

      expect(mockCheckpoint.create).toHaveBeenCalledWith(
        expect.objectContaining({ roundsSoFar, history }),
      );
    });

    it('attaches the pending tool (and any toolCalls already run for real) to the approval_request message', async () => {
      const priorToolCalls = [
        { tool: 'sql_server.get_database_schema', status: 'success' as const },
      ];
      const approvalNeeded = buildApprovalNeeded({}, undefined, priorToolCalls);

      await service.pauseForApproval(
        data,
        originalPrompt,
        [],
        priorToolCalls,
        [],
        approvalNeeded,
      );

      const approvalContent =
        mockMessageClient.createMessage.mock.calls[0][0].content;
      expect(mockMessageClient.updateMessage).toHaveBeenCalledWith({
        id: 'approval-msg-1',
        userId: data.botUserId,
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

    it('does NOT block the approval flow when attaching the toolCalls trace itself fails (cosmetic only)', async () => {
      mockMessageClient.updateMessage.mockRejectedValueOnce(
        new Error('message service unreachable'),
      );
      const approvalNeeded = buildApprovalNeeded();

      await expect(
        service.pauseForApproval(
          data,
          originalPrompt,
          [],
          [],
          [],
          approvalNeeded,
        ),
      ).resolves.toBeDefined();
      expect(mockCheckpoint.create).toHaveBeenCalled();
    });

    it('edits the orphaned approval message and rethrows when checkpoint.create() fails AFTER the message was already created', async () => {
      mockCheckpoint.create.mockRejectedValue(
        new Error('connect ECONNREFUSED'),
      );
      const approvalNeeded = buildApprovalNeeded();

      await expect(
        service.pauseForApproval(
          data,
          originalPrompt,
          [],
          [],
          [],
          approvalNeeded,
        ),
      ).rejects.toThrow('connect ECONNREFUSED');

      expect(mockMessageClient.updateMessage).toHaveBeenCalledWith({
        id: 'approval-msg-1',
        userId: data.botUserId,
        content: '⚠️ Không thể tạo yêu cầu duyệt, vui lòng hỏi lại.',
      });
    });
  });

  describe('buildRiskPreview (Giai đoạn 3 — HITL, Step 6)', () => {
    const getPreview = () =>
      (
        mockMessageClient.createMessage.mock.calls[0][0].content as {
          preview: string;
        }
      ).preview;

    it('runs a read-only COUNT derived from the WHERE clause and embeds the row estimate', async () => {
      mockMcpClient.callTool.mockResolvedValue({
        content: [{ type: 'text', text: '[{"affectedRows":12}]' }],
      });
      (extractTextFromMcpResult as jest.Mock).mockReturnValue(
        '[{"affectedRows":12}]',
      );
      const approvalNeeded = buildApprovalNeeded({
        args: { query: "UPDATE Orders SET Status='Completed' WHERE OrderId=1" },
      });

      await service.pauseForApproval(
        data,
        originalPrompt,
        [],
        [],
        [],
        approvalNeeded,
      );

      expect(mockMcpClient.callTool).toHaveBeenCalledWith({
        provider: 'sql_server',
        name: 'execute_read_only_query',
        args: {
          query: 'SELECT COUNT(*) AS affectedRows FROM Orders WHERE OrderId=1',
        },
        ownerId: data.userId,
      });
      expect(getPreview()).toBe('Sẽ ảnh hưởng ~12 dòng.');
    });

    it('warns about the whole table when DELETE has no WHERE clause, but still counts it for real', async () => {
      mockMcpClient.callTool.mockResolvedValue({
        content: [{ type: 'text', text: '[{"affectedRows":9999}]' }],
      });
      (extractTextFromMcpResult as jest.Mock).mockReturnValue(
        '[{"affectedRows":9999}]',
      );
      const approvalNeeded = buildApprovalNeeded({
        args: { query: 'DELETE FROM Orders' },
      });

      await service.pauseForApproval(
        data,
        originalPrompt,
        [],
        [],
        [],
        approvalNeeded,
      );

      expect(mockMcpClient.callTool).toHaveBeenCalledWith(
        expect.objectContaining({
          args: { query: 'SELECT COUNT(*) AS affectedRows FROM Orders' },
        }),
      );
      expect(getPreview()).toContain('KHÔNG có mệnh đề WHERE');
      expect(getPreview()).toContain('9999');
    });

    it('falls back to a generic preview showing the raw args for execute_stored_procedure (cannot estimate an arbitrary SP), without running a COUNT query', async () => {
      const approvalNeeded = buildApprovalNeeded({
        name: 'execute_stored_procedure',
        args: { query: "EXEC sp_x @a='1'" },
      });

      await service.pauseForApproval(
        data,
        originalPrompt,
        [],
        [],
        [],
        approvalNeeded,
      );

      expect(mockMcpClient.callTool).not.toHaveBeenCalled();
      expect(getPreview()).toContain(
        'Sẽ gọi "sql_server.execute_stored_procedure" với tham số:',
      );
      expect(getPreview()).toContain('sp_x');
    });

    it('falls back to a generic preview showing the raw args for other domains (VD github.create_issue), without running a COUNT query', async () => {
      const approvalNeeded: ApprovalRequiredDelegateResult = {
        approvalRequired: {
          provider: 'github',
          name: 'create_issue',
          args: { title: 'Bug' },
        },
        task: 'task',
        toolCalls: [],
      };

      await service.pauseForApproval(
        data,
        originalPrompt,
        [],
        [],
        [],
        approvalNeeded,
      );

      expect(mockMcpClient.callTool).not.toHaveBeenCalled();
      expect(getPreview()).toContain(
        'Sẽ gọi "github.create_issue" với tham số:',
      );
      expect(getPreview()).toContain('Bug');
      expect(getPreview()).toContain(
        'Không ước lượng được mức độ ảnh hưởng cụ thể — kiểm tra kỹ tham số trên trước khi duyệt.',
      );
    });

    it('falls back to a generic args preview if the COUNT query itself fails, instead of blocking the approval flow', async () => {
      mockMcpClient.callTool.mockRejectedValue(
        new Error('connect ECONNREFUSED'),
      );
      const approvalNeeded = buildApprovalNeeded({
        args: { query: 'DELETE FROM Orders WHERE OrderId=1' },
      });

      await service.pauseForApproval(
        data,
        originalPrompt,
        [],
        [],
        [],
        approvalNeeded,
      );

      expect(getPreview()).toContain(
        'Sẽ gọi "sql_server.execute_write_query" với tham số:',
      );
    });

    it('falls back to a generic args preview when the write query cannot be parsed (VD INSERT)', async () => {
      const approvalNeeded = buildApprovalNeeded({
        args: { query: "INSERT INTO Orders (Status) VALUES ('Pending')" },
      });

      await service.pauseForApproval(
        data,
        originalPrompt,
        [],
        [],
        [],
        approvalNeeded,
      );

      expect(mockMcpClient.callTool).not.toHaveBeenCalled();
      expect(getPreview()).toContain(
        'Sẽ gọi "sql_server.execute_write_query" với tham số:',
      );
      expect(getPreview()).toContain('INSERT INTO Orders');
    });
  });
});
