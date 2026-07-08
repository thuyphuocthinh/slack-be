import { Test, TestingModule } from '@nestjs/testing';
import {
  ORCHESTRATION_CONSTANTS,
  ORCHESTRATION_SELF_CHECK_PROMPT,
} from '@slack/constants';
import { ReactLoopService } from './react-loop.service';
import { McpClientService } from '../mcp/mcp-client.service';
import { LlmStrategyFactory } from './strategy/llm-strategy.factory';
import { AgentStreamService } from '../socket/agent-stream.service';
import { RunReactLoopRequestDto } from '../dto/react-loop.dto';
import { ApprovalRequiredError } from './approval-required.error';
import { CircuitBreakerService } from '../common/circuit-breaker.service';

// @slack/common barrel transitively kéo theo "nanoid" (ESM-only) qua
// string.util.ts — jest không transform được, mock thẳng theo đúng convention
// đã dùng ở auth.service.spec.ts thay vì để jest parse cả barrel thật.
jest.mock('@slack/common', () => ({
  extractTextFromMcpResult: jest.fn(
    (result?: { content?: { type: string; text?: string }[] }) => {
      if (!result?.content?.length) return '';
      return result.content
        .filter((c) => c.type === 'text' && c.text)
        .map((c) => c.text)
        .join('\n');
    },
  ),
}));

describe('ReactLoopService', () => {
  let service: ReactLoopService;

  const mockMcpClient = { 
    getTools: jest.fn(), 
    callTool: jest.fn(),
    getResources: jest.fn(),
    readResource: jest.fn(),
  };
  const mockAgentStream = { emitStep: jest.fn() };
  const mockSession = { sendMessage: jest.fn() };
  const mockStrategy = {
    id: 'gemini',
    startChat: jest.fn().mockReturnValue(mockSession),
  };
  const mockLlmFactory = {
    resolve: jest
      .fn()
      .mockReturnValue({ strategy: mockStrategy, model: 'gemini-2.0-flash' }),
  };
  // Pass-through mặc định — giữ nguyên hành vi mọi test đã có từ trước Step 6.
  const mockCircuitBreaker = {
    run: jest.fn((_key: string, action: () => Promise<unknown>) => action()),
  };

  const baseDto: RunReactLoopRequestDto = {
    prompt: 'có bao nhiêu bảng trong DB?',
    provider: 'sql_server',
    userId: 'user-1',
    channelId: 'channel-1',
    workspaceId: 'workspace-1',
    messageId: 'reply-msg-1',
    channelType: 'direct',
    history: [],
  };

  beforeEach(async () => {
    mockMcpClient.getTools.mockResolvedValue([
      { name: 'get_database_schema', description: 'desc', inputSchema: {} },
    ]);
    mockMcpClient.getResources.mockResolvedValue([]);
    mockMcpClient.readResource.mockResolvedValue('');
    mockMcpClient.callTool.mockResolvedValue({
      content: [{ type: 'text', text: 'result data' }],
      isError: false,
    });
    mockCircuitBreaker.run.mockImplementation(
      (_key: string, action: () => Promise<unknown>) => action(),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReactLoopService,
        { provide: McpClientService, useValue: mockMcpClient },
        { provide: LlmStrategyFactory, useValue: mockLlmFactory },
        { provide: AgentStreamService, useValue: mockAgentStream },
        { provide: CircuitBreakerService, useValue: mockCircuitBreaker },
      ],
    }).compile();

    service = module.get<ReactLoopService>(ReactLoopService);
  });

  afterEach(() => jest.clearAllMocks());

  it('returns the answer immediately when the model never calls a tool', async () => {
    mockSession.sendMessage.mockResolvedValueOnce({
      text: 'Xin chào!',
      toolCalls: [],
    });

    const result = await service.run(baseDto);

    expect(result).toEqual({ answer: 'Xin chào!', toolCalls: [] });
    expect(mockSession.sendMessage).toHaveBeenCalledTimes(1);
    // Không tool call nào chạy — không có step nào phát ra. Tín hiệu "done"
    // giờ do AiOrchestrationProcessor lo, KHÔNG phải trách nhiệm của ReactLoopService.
    expect(mockAgentStream.emitStep).not.toHaveBeenCalled();
  });

  it('runs the self-check nudge exactly once after the model stops calling tools, but keeps the answer from BEFORE the nudge (Giai đoạn 4 bug fix — self-check response is a meta-confirmation, not a real data-bearing answer)', async () => {
    mockSession.sendMessage
      .mockResolvedValueOnce({
        text: '',
        toolCalls: [{ name: 'get_database_schema', args: {} }],
      })
      .mockResolvedValueOnce({ text: 'Đây là schema.', toolCalls: [] })
      .mockResolvedValueOnce({
        text: 'Xác nhận đã đủ dữ liệu.',
        toolCalls: [],
      });

    const result = await service.run(baseDto);

    // Đây là bug thật gặp khi test: nếu dùng thẳng câu xác nhận meta của
    // self-check ("Xác nhận đã đủ dữ liệu.") làm answer, dữ liệu thật (câu
    // TRƯỚC self-check, "Đây là schema.") bị mất — Supervisor nhận 1 round
    // rỗng dữ liệu và phải tự bịa số khi tổng hợp câu trả lời cuối.
    expect(result.answer).toBe('Đây là schema.');
    // tool namespace theo "{provider}.{toolName}" (Step 6) — tránh lẫn lộn
    // khi 1 turn gộp toolCalls từ nhiều agent khác nhau.
    expect(result.toolCalls).toEqual([
      {
        tool: 'sql_server.get_database_schema',
        status: 'success',
        resultPreview: 'result data',
      },
    ]);
    expect(mockSession.sendMessage).toHaveBeenCalledTimes(3);
    expect(mockSession.sendMessage).toHaveBeenNthCalledWith(
      3,
      ORCHESTRATION_SELF_CHECK_PROMPT,
    );
  });

  it('does not nudge a second time — stops after exactly one self-check round', async () => {
    mockSession.sendMessage
      .mockResolvedValueOnce({
        text: '',
        toolCalls: [{ name: 'get_database_schema', args: {} }],
      })
      .mockResolvedValueOnce({ text: 'chưa chắc lắm', toolCalls: [] })
      .mockResolvedValueOnce({
        text: 'vẫn giữ nguyên câu trả lời',
        toolCalls: [],
      });

    await service.run(baseDto);

    // 1 initial + 1 sau tool call + 1 self-check = 3, không có lượt nudge thứ 2
    expect(mockSession.sendMessage).toHaveBeenCalledTimes(3);
  });

  it('continues the loop normally (no second self-check) when the self-check nudge itself decides another tool call is needed', async () => {
    mockSession.sendMessage
      .mockResolvedValueOnce({
        text: '',
        toolCalls: [{ name: 'get_database_schema', args: {} }],
      })
      .mockResolvedValueOnce({ text: 'câu trả lời tạm', toolCalls: [] })
      .mockResolvedValueOnce({
        text: '',
        toolCalls: [{ name: 'execute_read_only_query', args: {} }],
      })
      .mockResolvedValueOnce({
        text: 'câu trả lời cuối, có dữ liệu thật',
        toolCalls: [],
      });

    const result = await service.run(baseDto);

    expect(result.answer).toBe('câu trả lời cuối, có dữ liệu thật');
    expect(mockMcpClient.callTool).toHaveBeenCalledTimes(2);
    // 1 initial + 1 sau tool A + 1 self-check (muốn gọi tool B) + 1 sau tool B = 4
    expect(mockSession.sendMessage).toHaveBeenCalledTimes(4);
  });

  it('stops after MAX_REACT_STEPS iterations and returns the fallback message if the model never converges', async () => {
    mockSession.sendMessage.mockResolvedValue({
      text: '',
      toolCalls: [{ name: 'get_database_schema', args: {} }],
    });

    const result = await service.run(baseDto);

    expect(result.answer).toBe(
      'Xin lỗi, câu hỏi này cần nhiều bước hơn mình hỗ trợ được.',
    );
    expect(mockMcpClient.callTool).toHaveBeenCalledTimes(
      ORCHESTRATION_CONSTANTS.MAX_REACT_STEPS,
    );
    // 1 lượt gọi ban đầu + đúng MAX_REACT_STEPS lượt trong loop
    expect(mockSession.sendMessage).toHaveBeenCalledTimes(
      ORCHESTRATION_CONSTANTS.MAX_REACT_STEPS + 1,
    );
  });

  it('starts the chat with a low temperature (Step 7 — anti-hallucination for tool calls)', async () => {
    mockSession.sendMessage.mockResolvedValueOnce({
      text: 'ok',
      toolCalls: [],
    });

    await service.run(baseDto);

    expect(mockStrategy.startChat).toHaveBeenCalledWith(
      expect.objectContaining({
        temperature: ORCHESTRATION_CONSTANTS.REACT_LOOP_TEMPERATURE,
      }),
    );
  });

  it('passes dto.history straight through to startChat without fetching it itself (Step 7 — caller fetches once, shared with Supervisor)', async () => {
    mockSession.sendMessage.mockResolvedValueOnce({
      text: 'ok',
      toolCalls: [],
    });
    const history = [{ role: 'user' as const, text: 'câu hỏi trước đó' }];

    await service.run({ ...baseDto, history });

    expect(mockStrategy.startChat).toHaveBeenCalledWith(
      expect.objectContaining({ history }),
    );
  });

  it('resolves the model via LlmStrategyFactory using dto.model when provided, falling back to the default otherwise', async () => {
    mockSession.sendMessage.mockResolvedValueOnce({
      text: 'ok',
      toolCalls: [],
    });

    await service.run({ ...baseDto, model: 'gpt-4o-mini' });
    expect(mockLlmFactory.resolve).toHaveBeenCalledWith('gpt-4o-mini');

    mockSession.sendMessage.mockResolvedValueOnce({
      text: 'ok',
      toolCalls: [],
    });
    await service.run(baseDto);
    expect(mockLlmFactory.resolve).toHaveBeenCalledWith(
      ORCHESTRATION_CONSTANTS.DEFAULT_REACT_MODEL,
    );
  });

  describe('tool step streaming (via AgentStreamService)', () => {
    it('emits tool_call then tool_result with the reply messageId/channel context, in order', async () => {
      mockSession.sendMessage
        .mockResolvedValueOnce({
          text: '',
          toolCalls: [{ name: 'get_database_schema', args: {} }],
        })
        .mockResolvedValueOnce({ text: 'ok', toolCalls: [] })
        .mockResolvedValueOnce({ text: 'vẫn giữ nguyên', toolCalls: [] }); // self-check round

      await service.run({ ...baseDto, channelType: 'group' });

      expect(mockAgentStream.emitStep).toHaveBeenNthCalledWith(
        1,
        {
          userId: 'user-1',
          channelId: 'channel-1',
          messageId: 'reply-msg-1',
          channelType: 'group',
        },
        { type: 'tool_call', tool: 'sql_server.get_database_schema' },
      );
      expect(mockAgentStream.emitStep).toHaveBeenNthCalledWith(
        2,
        {
          userId: 'user-1',
          channelId: 'channel-1',
          messageId: 'reply-msg-1',
          channelType: 'group',
        },
        {
          type: 'tool_result',
          tool: 'sql_server.get_database_schema',
          status: 'success',
          resultPreview: 'result data',
        },
      );
      // "done" KHÔNG phải việc của ReactLoopService nữa
      expect(mockAgentStream.emitStep).not.toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ type: 'done' }),
      );
    });

    it('namespaces the tool name by dto.provider, not hard-coded (Step 6 — avoid collisions across agents)', async () => {
      mockSession.sendMessage
        .mockResolvedValueOnce({
          text: '',
          toolCalls: [{ name: 'list_issues', args: {} }],
        })
        .mockResolvedValueOnce({ text: 'ok', toolCalls: [] })
        .mockResolvedValueOnce({ text: 'vẫn giữ nguyên', toolCalls: [] });

      const result = await service.run({ ...baseDto, provider: 'github' });

      expect(result.toolCalls).toEqual([
        {
          tool: 'github.list_issues',
          status: 'success',
          resultPreview: 'result data',
        },
      ]);
      // Gọi MCP server thật vẫn dùng đúng tên gốc "list_issues", KHÔNG bị namespace
      expect(mockMcpClient.callTool).toHaveBeenCalledWith(
        expect.objectContaining({ provider: 'github', name: 'list_issues' }),
      );
    });

    it('marks the step as "error" when the MCP tool call itself errors out', async () => {
      mockMcpClient.callTool.mockResolvedValue({
        content: [{ type: 'text', text: 'DB connection failed' }],
        isError: true,
      });
      mockSession.sendMessage
        .mockResolvedValueOnce({
          text: '',
          toolCalls: [{ name: 'get_database_schema', args: {} }],
        })
        .mockResolvedValueOnce({ text: 'ok', toolCalls: [] })
        .mockResolvedValueOnce({ text: 'vẫn giữ nguyên', toolCalls: [] });

      const result = await service.run(baseDto);

      expect(result.toolCalls[0].status).toBe('error');
      expect(mockAgentStream.emitStep).toHaveBeenNthCalledWith(
        2,
        expect.anything(),
        expect.objectContaining({ type: 'tool_result', status: 'error' }),
      );
    });

    it('does NOT truncate the tool result — resultPreview carries the full text, only whitespace collapsed to 1 line', async () => {
      const longText = 'x'.repeat(5000);
      mockMcpClient.callTool.mockResolvedValue({
        content: [{ type: 'text', text: `long\nresult  ${longText}` }],
        isError: false,
      });
      mockSession.sendMessage
        .mockResolvedValueOnce({
          text: '',
          toolCalls: [{ name: 'get_database_schema', args: {} }],
        })
        .mockResolvedValueOnce({ text: 'ok', toolCalls: [] })
        .mockResolvedValueOnce({ text: 'vẫn giữ nguyên', toolCalls: [] });

      const result = await service.run(baseDto);

      expect(result.toolCalls[0].resultPreview).toBe(`long result ${longText}`);
      expect(result.toolCalls[0].resultPreview!.length).toBeGreaterThan(200);
    });
  });

  describe('Risk Gate (Giai đoạn 3 — HITL, Step 3)', () => {
    it('throws ApprovalRequiredError instead of calling the tool when destructiveHint is true', async () => {
      mockMcpClient.getTools.mockResolvedValue([
        {
          name: 'execute_write_query',
          description: 'desc',
          inputSchema: {},
          annotations: { readOnlyHint: false, destructiveHint: true },
        },
      ]);
      mockSession.sendMessage.mockResolvedValueOnce({
        text: '',
        toolCalls: [
          {
            name: 'execute_write_query',
            args: {
              query: "UPDATE Orders SET Status='Completed' WHERE OrderId=1",
            },
          },
        ],
      });

      await expect(service.run(baseDto)).rejects.toThrow(ApprovalRequiredError);

      expect(mockMcpClient.callTool).not.toHaveBeenCalled();
      expect(mockAgentStream.emitStep).not.toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ type: 'tool_call' }),
      );
    });

    it('carries {provider, name, args} on the thrown error so the checkpoint can be built from it', async () => {
      mockMcpClient.getTools.mockResolvedValue([
        {
          name: 'execute_write_query',
          description: 'desc',
          inputSchema: {},
          annotations: { readOnlyHint: false, destructiveHint: true },
        },
      ]);
      const args = { query: 'DELETE FROM Orders WHERE OrderId=1' };
      mockSession.sendMessage.mockResolvedValueOnce({
        text: '',
        toolCalls: [{ name: 'execute_write_query', args }],
      });

      const error = await service.run(baseDto).catch((e) => e);

      expect(error).toBeInstanceOf(ApprovalRequiredError);
      expect(error.pendingTool).toEqual({
        provider: 'sql_server',
        name: 'execute_write_query',
        args,
      });
    });

    it('still auto-runs tools without destructiveHint (safe tools unaffected)', async () => {
      mockMcpClient.getTools.mockResolvedValue([
        {
          name: 'get_database_schema',
          description: 'desc',
          inputSchema: {},
          annotations: { readOnlyHint: true },
        },
      ]);
      mockSession.sendMessage
        .mockResolvedValueOnce({
          text: '',
          toolCalls: [{ name: 'get_database_schema', args: {} }],
        })
        .mockResolvedValueOnce({ text: 'ok', toolCalls: [] })
        .mockResolvedValueOnce({ text: 'vẫn giữ nguyên', toolCalls: [] });

      const result = await service.run(baseDto);

      expect(mockMcpClient.callTool).toHaveBeenCalledTimes(1);
      // Giữ câu trả lời TRƯỚC self-check ("ok", có dữ liệu thật) — không phải
      // câu xác nhận meta của self-check ("vẫn giữ nguyên").
      expect(result.answer).toBe('ok');
    });
  });

  describe('Giai đoạn 4, Step 6 — circuit breaker theo strategy.id', () => {
    it('routes every sendMessage() call through the breaker keyed by "llm:<strategy.id>"', async () => {
      mockSession.sendMessage.mockResolvedValueOnce({
        text: 'ok',
        toolCalls: [],
      });

      await service.run(baseDto);

      expect(mockCircuitBreaker.run).toHaveBeenCalledWith(
        'llm:gemini',
        expect.any(Function),
      );
    });

    it('propagates a circuit-open rejection straight through, without calling session.sendMessage()', async () => {
      mockCircuitBreaker.run.mockRejectedValueOnce(
        new Error(
          'THIS PROVIDER IS TEMPORARILY UNAVAILABLE (CIRCUIT BREAKER OPEN) (key=llm:gemini)',
        ),
      );

      await expect(service.run(baseDto)).rejects.toThrow(
        'CIRCUIT BREAKER OPEN',
      );
      expect(mockSession.sendMessage).not.toHaveBeenCalled();
    });
  });
});
