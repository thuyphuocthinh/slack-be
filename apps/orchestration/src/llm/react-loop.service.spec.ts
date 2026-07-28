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
import { AgentCancellationService } from '../cancellation/agent-cancellation.service';

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
  // Mặc định "chưa bị huỷ" — runCancellable() poll cái này, test nào cần mô
  // phỏng Stop thì tự mockResolvedValueOnce(true).
  const mockCancellation = {
    isCancelled: jest.fn().mockResolvedValue(false),
    startTurn: jest.fn(),
    requestCancel: jest.fn(),
    getOwner: jest.fn(),
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
    mockCancellation.isCancelled.mockResolvedValue(false);
    // resync()/onToken() luôn gọi emitStep(...).catch(...) — cần resolve thật
    // (không phải undefined mặc định của jest.fn()) để .catch() không throw.
    mockAgentStream.emitStep.mockResolvedValue(undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReactLoopService,
        { provide: McpClientService, useValue: mockMcpClient },
        { provide: LlmStrategyFactory, useValue: mockLlmFactory },
        { provide: AgentStreamService, useValue: mockAgentStream },
        { provide: CircuitBreakerService, useValue: mockCircuitBreaker },
        { provide: AgentCancellationService, useValue: mockCancellation },
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
        argsPreview: '{}',
      },
    ]);
    expect(mockSession.sendMessage).toHaveBeenCalledTimes(3);
    expect(mockSession.sendMessage).toHaveBeenNthCalledWith(
      3,
      ORCHESTRATION_SELF_CHECK_PROMPT,
      expect.any(Function),
      expect.anything(),
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

  it('executes multiple tool calls in a single turn SEQUENTIALLY, never overlapping (bug fix: parallel execution raced the repeat-guard/Risk Gate and desynced tool_call/tool_result FE events for same-name calls)', async () => {
    mockSession.sendMessage
      .mockResolvedValueOnce({
        text: '',
        toolCalls: [
          { name: 'get_table1', args: {} },
          { name: 'get_table2', args: {} },
        ],
      })
      .mockResolvedValueOnce({ text: 'đã tổng hợp xong 2 bảng', toolCalls: [] })
      .mockResolvedValueOnce({ text: 'xác nhận đã xong', toolCalls: [] });

    // Cố tình delay callTool để kiểm tra KHÔNG có lúc nào 2 call cùng "in-flight".
    let activeCalls = 0;
    let maxConcurrent = 0;
    const callOrder: string[] = [];
    mockMcpClient.callTool.mockImplementation(async (dto: { name: string }) => {
      activeCalls++;
      maxConcurrent = Math.max(maxConcurrent, activeCalls);
      callOrder.push(dto.name);
      await new Promise((resolve) => setTimeout(resolve, 50));
      activeCalls--;
      return { content: [{ type: 'text', text: 'data' }], isError: false };
    });

    const result = await service.run(baseDto);

    expect(result.answer).toBe('đã tổng hợp xong 2 bảng');
    expect(mockMcpClient.callTool).toHaveBeenCalledTimes(2);
    expect(maxConcurrent).toBe(1); // Không bao giờ có 2 tool cùng chạy 1 lúc
    expect(callOrder).toEqual(['get_table1', 'get_table2']); // đúng thứ tự model yêu cầu
  });

  it('stops after MAX_REACT_STEPS iterations and returns the fallback message if the model never converges', async () => {
    // Tham số đổi mỗi lượt (mục 4 — repeat-limiter chặn CÙNG tool + CÙNG tham
    // số, không liên quan tới guard MAX_REACT_STEPS đang test ở đây) để cô
    // lập đúng 1 guard đang kiểm tra.
    let call = 0;
    mockSession.sendMessage.mockImplementation(() =>
      Promise.resolve({
        text: '',
        toolCalls: [{ name: 'get_database_schema', args: { step: call++ } }],
      }),
    );

    const result = await service.run(baseDto);

    // accuracy_problem.md — mọi tool call ở test này đều THÀNH CÔNG (mock mặc
    // định), nên bắt buộc phải kèm caveat "đã thực hiện thành công trước khi
    // dừng" — tránh user tưởng nhầm chưa có gì xảy ra rồi lặp lại thao tác.
    expect(result.answer).toBe(
      'Xin lỗi, câu hỏi này cần nhiều bước hơn mình hỗ trợ được. Một số hành động (đọc/ghi dữ liệu) đã thực hiện THÀNH CÔNG trước khi dừng — kiểm tra lại kết quả hiện có trước khi yêu cầu lại, tránh lặp lại đúng thao tác đã làm.',
    );
    expect(mockMcpClient.callTool).toHaveBeenCalledTimes(
      ORCHESTRATION_CONSTANTS.MAX_REACT_STEPS,
    );
    // 1 lượt gọi ban đầu + đúng MAX_REACT_STEPS lượt trong loop
    expect(mockSession.sendMessage).toHaveBeenCalledTimes(
      ORCHESTRATION_CONSTANTS.MAX_REACT_STEPS + 1,
    );
  });

  it('accuracy_problem.md — KHÔNG kèm caveat "đã thực hiện thành công" khi hết MAX_REACT_STEPS mà KHÔNG có tool call nào thành công (không có gì để cảnh báo lặp lại)', async () => {
    let call = 0;
    mockSession.sendMessage.mockImplementation(() =>
      Promise.resolve({
        text: '',
        toolCalls: [{ name: 'get_database_schema', args: { step: call++ } }],
      }),
    );
    mockMcpClient.callTool.mockResolvedValue({
      content: [{ type: 'text', text: 'lỗi mô phỏng' }],
      isError: true,
    });

    const result = await service.run(baseDto);

    expect(result.answer).toBe(
      'Xin lỗi, câu hỏi này cần nhiều bước hơn mình hỗ trợ được.',
    );
  });

  it('passes dto.prompt as the query to mcpClient.getTools (Giai đoạn 4 — Tool RAG, semantic tool search for large providers)', async () => {
    mockSession.sendMessage.mockResolvedValueOnce({
      text: 'ok',
      toolCalls: [],
    });

    await service.run(baseDto);

    expect(mockMcpClient.getTools).toHaveBeenCalledWith(
      'sql_server',
      baseDto.prompt,
      expect.any(AbortSignal),
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

  it('fetches MCP resources and injects them into systemInstruction', async () => {
    mockSession.sendMessage.mockResolvedValueOnce({
      text: 'ok',
      toolCalls: [],
    });

    mockMcpClient.getResources.mockResolvedValueOnce([
      { uri: 'resource://1', name: 'DatabaseSchema', description: 'DB' },
    ]);
    mockMcpClient.readResource.mockResolvedValueOnce('TABLE users (id INT)');

    await service.run(baseDto);

    expect(mockMcpClient.getResources).toHaveBeenCalledWith(
      'sql_server',
      expect.any(AbortSignal),
    );
    expect(mockMcpClient.readResource).toHaveBeenCalledWith(
      'sql_server',
      'resource://1',
      'user-1',
      expect.any(AbortSignal),
    );
    expect(mockStrategy.startChat).toHaveBeenCalledWith(
      expect.objectContaining({
        systemInstruction: expect.stringContaining('TABLE users (id INT)'),
      }),
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

      // Vòng #1 có tool-call — resync('') bắn TRƯỚC tool_call (preamble nếu có
      // của vòng đó không phải câu trả lời cuối, xem "stream = save").
      expect(mockAgentStream.emitStep).toHaveBeenNthCalledWith(
        1,
        {
          userId: 'user-1',
          channelId: 'channel-1',
          messageId: 'reply-msg-1',
          channelType: 'group',
        },
        { type: 'resync', text: '' },
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
          type: 'tool_call',
          tool: 'sql_server.get_database_schema',
          argsPreview: '{}',
        },
      );
      expect(mockAgentStream.emitStep).toHaveBeenNthCalledWith(
        3,
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
      // Vòng self-check ('vẫn giữ nguyên') bị revert — resync về đúng
      // answerBeforeSelfCheck ('ok'), không phải nội dung self-check vừa nói.
      expect(mockAgentStream.emitStep).toHaveBeenNthCalledWith(
        4,
        expect.anything(),
        { type: 'resync', text: 'ok' },
      );
    });

    // UX — code Python thật của run_python (hoặc câu SQL thật) phải hiện được
    // cho user xem/copy trên UI, không chỉ tồn tại thoáng qua trong debug log.
    it('shows a single string argument RAW (multi-line code stays readable) instead of JSON-escaping it', async () => {
      const pythonCode =
        'import statistics\nprint(statistics.pstdev([1, 2, 3]))';
      mockSession.sendMessage
        .mockResolvedValueOnce({
          text: '',
          toolCalls: [
            { name: 'get_database_schema', args: { code: pythonCode } },
          ],
        })
        .mockResolvedValueOnce({ text: 'ok', toolCalls: [] })
        .mockResolvedValueOnce({ text: 'vẫn giữ nguyên', toolCalls: [] });

      const result = await service.run(baseDto);

      expect(result.toolCalls[0].argsPreview).toBe(pythonCode);
      expect(mockAgentStream.emitStep).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ type: 'tool_call', argsPreview: pythonCode }),
      );
    });

    it('JSON-stringifies multi-argument tool calls instead of showing [object Object]', async () => {
      mockSession.sendMessage
        .mockResolvedValueOnce({
          text: '',
          toolCalls: [
            { name: 'get_database_schema', args: { repo: 'a/b', title: 'x' } },
          ],
        })
        .mockResolvedValueOnce({ text: 'ok', toolCalls: [] })
        .mockResolvedValueOnce({ text: 'vẫn giữ nguyên', toolCalls: [] });

      const result = await service.run(baseDto);

      expect(result.toolCalls[0].argsPreview).toBe(
        JSON.stringify({ repo: 'a/b', title: 'x' }, null, 2),
      );
    });

    // accuracy_problem.md mục 11 (trace UI) — bug thật: emitStep() riêng dùng
    // cho tool_call/tool_result (KHÁC emitToken() dùng cho token/resync) từng
    // thiếu hẳn `streamKey` — MỌI tool_call/tool_result rơi về mặc định
    // 'main' bất kể dto.streamKey là gì, tách rời khỏi nhóm đúng (được
    // TurnResolverService tạo qua step_start, DÙNG ĐÚNG streamKey của bước
    // đó) — FE thấy 2 nhóm: 1 có nhãn nhưng rỗng, 1 "main" không nhãn nhưng
    // chứa dữ liệu tool thật. Test tất cả LOẠI event (tool_call/tool_result/
    // token/resync) đều mang ĐÚNG CÙNG 1 streamKey khi dto có set streamKey
    // (baseDto ở trên KHÔNG set, nên các test khác không bắt được bug này).
    it('carries dto.streamKey through EVERY step type (tool_call/tool_result/token/resync), not just token/resync', async () => {
      mockSession.sendMessage
        .mockResolvedValueOnce({
          text: '',
          toolCalls: [{ name: 'get_database_schema', args: {} }],
        })
        .mockResolvedValueOnce({ text: 'ok', toolCalls: [] })
        .mockResolvedValueOnce({ text: 'vẫn giữ nguyên', toolCalls: [] }); // self-check round

      await service.run({ ...baseDto, streamKey: 'r0-sql_server' });

      for (const [context] of mockAgentStream.emitStep.mock.calls) {
        expect(context).toEqual(
          expect.objectContaining({ streamKey: 'r0-sql_server' }),
        );
      }
      // Xác nhận CỤ THỂ tool_call/tool_result (không chỉ resync/token) có mặt
      // trong assertion trên — tránh false-positive nếu vòng lặp trên rỗng.
      const toolEventTypes = mockAgentStream.emitStep.mock.calls
        .map(([, step]) => step.type)
        .filter((t) => t === 'tool_call' || t === 'tool_result');
      expect(toolEventTypes).toEqual(['tool_call', 'tool_result']);
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
          argsPreview: '{}',
        },
      ]);
      // Gọi MCP server thật vẫn dùng đúng tên gốc "list_issues", KHÔNG bị namespace
      expect(mockMcpClient.callTool).toHaveBeenCalledWith(
        expect.objectContaining({ provider: 'github', name: 'list_issues' }),
        expect.anything(),
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
      // Call #1 = resync('') (vòng có tool-call), #2 = tool_call, #3 = tool_result.
      expect(mockAgentStream.emitStep).toHaveBeenNthCalledWith(
        3,
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

    it('caps the tool result text fed BACK to the LLM once it exceeds the context-safety limit, without touching resultPreview', async () => {
      // accuracy_problem.md mục 5 — budget giờ tính THEO model thật
      // (gpt-4o-mini ~153.600 ký tự), không còn hằng số cứng 6000 — dữ liệu
      // phải vượt XA budget mới để còn kiểm được hành vi cap.
      const hugeText = 'y'.repeat(160_000);
      mockMcpClient.callTool.mockResolvedValue({
        content: [{ type: 'text', text: hugeText }],
        isError: false,
      });
      mockSession.sendMessage
        .mockResolvedValueOnce({
          text: '',
          toolCalls: [{ name: 'get_database_schema', args: {} }],
        })
        .mockImplementationOnce((input) => {
          // input ở đây là mảng LlmToolResult[] — content chính là text bị cap.
          const fedBackText = (input as { content: string }[])[0].content;
          expect(fedBackText.length).toBeLessThan(hugeText.length);
          expect(fedBackText).toContain('[truncated');
          return Promise.resolve({ text: 'ok', toolCalls: [] });
        });

      const result = await service.run(baseDto);

      // resultPreview (trace UI) vẫn đầy đủ, không bị cap.
      expect(result.toolCalls[0].resultPreview).toBe(hugeText);
    });

    it('accuracy_problem.md mục 5 — KHÔNG cắt kết quả tool cỡ thật (VD 500 dòng SQL, ~40k ký tự) trước khi feed lại cho LLM trong CÙNG 1 lượt ReactLoop', async () => {
      const fiveHundredRows = JSON.stringify(
        Array.from({ length: 500 }, (_, i) => ({
          id: i,
          name: `Khách hàng ${i}`,
          email: `customer${i}@example.com`,
        })),
      );
      mockMcpClient.callTool.mockResolvedValue({
        content: [{ type: 'text', text: fiveHundredRows }],
        isError: false,
      });
      mockSession.sendMessage
        .mockResolvedValueOnce({
          text: '',
          toolCalls: [{ name: 'get_database_schema', args: {} }],
        })
        .mockImplementationOnce((input) => {
          const fedBackText = (input as { content: string }[])[0].content;
          expect(fedBackText).toContain('"id":0');
          expect(fedBackText).toContain('"id":499');
          expect(fedBackText).not.toContain('truncated');
          return Promise.resolve({ text: 'ok', toolCalls: [] });
        });

      await service.run(baseDto);
    });
  });

  describe('mục 4 — tool-call error handling (react-loop.service.ts)', () => {
    it('emits exactly one tool_result with status "error" and keeps the loop going, when mcpClient.callTool() itself throws (thay vì bay exception qua, bỏ luôn bước emit — trace bị kẹt "pending")', async () => {
      mockMcpClient.callTool.mockRejectedValueOnce(new Error('ECONNREFUSED'));
      mockSession.sendMessage
        .mockResolvedValueOnce({
          text: '',
          toolCalls: [{ name: 'get_database_schema', args: {} }],
        })
        .mockResolvedValueOnce({ text: 'ok', toolCalls: [] })
        .mockResolvedValueOnce({ text: 'vẫn giữ nguyên', toolCalls: [] });

      const result = await service.run(baseDto);

      expect(result.toolCalls[0]).toEqual({
        tool: 'sql_server.get_database_schema',
        status: 'error',
        resultPreview: 'ECONNREFUSED',
        argsPreview: '{}',
      });
      // Call #1 = resync(''), #2 = tool_call, #3 = tool_result (error) — không
      // có lần emit "pending" nào bị bỏ dở.
      expect(mockAgentStream.emitStep).toHaveBeenNthCalledWith(
        3,
        expect.anything(),
        {
          type: 'tool_result',
          tool: 'sql_server.get_database_schema',
          status: 'error',
          resultPreview: 'ECONNREFUSED',
        },
      );
      // Lỗi được feed NGƯỢC LẠI cho LLM (không throw ra ngoài run()) — turn
      // tiếp tục bình thường, LLM tự quyết định câu trả lời tiếp theo.
      const fedBackToLlm = mockSession.sendMessage.mock.calls[1][0];
      expect(fedBackToLlm[0].content).toBe('ECONNREFUSED');
      expect(result.answer).toBe('ok');
    });

    it('blocks a second call to the same tool+args right after the first one FAILS — no retry for application-level errors, only connection errors get retried (and that retry is invisible, inside McpClientService)', async () => {
      mockMcpClient.callTool.mockResolvedValue({
        content: [{ type: 'text', text: 'HTTP 500 upstream error' }],
        isError: true,
      });
      mockSession.sendMessage.mockResolvedValue({
        text: '',
        toolCalls: [{ name: 'get_database_schema', args: { x: 1 } }],
      });

      const result = await service.run(baseDto);

      // Đúng 1 lần gọi tool THẬT — lỗi ứng dụng (đã kết nối được, chỉ là bản
      // thân request lỗi) không có lý do gì để retry với ĐÚNG tham số đó,
      // nên MAX_SAME_TOOL_CALL_REPEATS=1 chặn ngay từ lần lặp thứ 2.
      expect(mockMcpClient.callTool).toHaveBeenCalledTimes(1);
      expect(result.toolCalls).toHaveLength(
        ORCHESTRATION_CONSTANTS.MAX_REACT_STEPS,
      );
      expect(result.toolCalls[0].status).toBe('error'); // lần gọi thật, tool trả lỗi
      const blockedAfterFirst = result.toolCalls.slice(1);
      expect(blockedAfterFirst.every((t) => t.status === 'error')).toBe(true);
    });

    it('serves a repeated identical call from cache instead of hitting the real tool again (bug: model re-called google_docs.get_document_content twice in a row even though the first call already succeeded)', async () => {
      mockSession.sendMessage
        .mockResolvedValueOnce({
          text: '',
          toolCalls: [
            { name: 'get_database_schema', args: { x: 1 } },
            { name: 'get_database_schema', args: { x: 1 } },
          ],
        })
        .mockResolvedValueOnce({ text: 'đã xong', toolCalls: [] })
        .mockResolvedValueOnce({ text: 'xác nhận đã xong', toolCalls: [] });

      const result = await service.run(baseDto);

      // 2 tool_call trong CÙNG 1 response, cùng tham số — chỉ tool THẬT chạy
      // đúng 1 lần, lần thứ 2 lấy từ cache nhưng vẫn hiện đúng như 1 lần gọi
      // thành công trên trace (để UI không đổi hành vi hiển thị).
      expect(mockMcpClient.callTool).toHaveBeenCalledTimes(1);
      const expectedArgsPreview = JSON.stringify({ x: 1 }, null, 2);
      expect(result.toolCalls.slice(0, 2)).toEqual([
        {
          tool: 'sql_server.get_database_schema',
          status: 'success',
          resultPreview: 'result data',
          argsPreview: expectedArgsPreview,
        },
        {
          tool: 'sql_server.get_database_schema',
          status: 'success',
          resultPreview: 'result data',
          argsPreview: expectedArgsPreview,
        },
      ]);
    });

    it('keeps reusing the cached success for a signature that already succeeded, no matter how many times it repeats — never hard-blocks a proven-good call', async () => {
      mockSession.sendMessage.mockResolvedValue({
        text: '',
        toolCalls: [{ name: 'get_database_schema', args: { x: 1 } }],
      });
      // Mặc định beforeEach đã mock callTool trả về thành công.

      const result = await service.run(baseDto);

      expect(mockMcpClient.callTool).toHaveBeenCalledTimes(1); // chỉ 1 lần thật, còn lại phục vụ từ cache
      expect(result.toolCalls).toHaveLength(
        ORCHESTRATION_CONSTANTS.MAX_REACT_STEPS,
      );
      // KHÔNG có entry nào bị chặn cứng — cache-hit luôn ưu tiên hơn ngưỡng chặn.
      expect(result.toolCalls.every((t) => t.status === 'success')).toBe(true);
    });

    it('names the other available tools in the block message so the LLM has a concrete next step instead of re-reading forever (bug: model kept re-calling get_document_content instead of ever trying append_document_text)', async () => {
      mockMcpClient.getTools.mockResolvedValue([
        { name: 'get_document_content', description: 'desc', inputSchema: {} },
        {
          name: 'append_document_text',
          description: 'desc',
          inputSchema: {},
          annotations: { readOnlyHint: false, destructiveHint: false },
        },
      ]);
      mockMcpClient.callTool.mockResolvedValue({
        content: [{ type: 'text', text: 'not found' }],
        isError: true,
      });
      mockSession.sendMessage.mockResolvedValue({
        text: '',
        toolCalls: [
          { name: 'get_document_content', args: { documentId: 'doc-1' } },
        ],
      });

      const result = await service.run(baseDto);

      const blocked = result.toolCalls.find((t) =>
        t.resultPreview?.includes('KHÔNG được gọi lại tool này'),
      );
      expect(blocked?.resultPreview).toContain('KHÔNG được gọi lại tool này');
      // Gợi ý phải liệt kê CHÍNH XÁC tool còn lại (append_document_text),
      // không lặp lại chính tool vừa bị chặn (get_document_content) trong gợi ý.
      expect(blocked?.resultPreview).toMatch(/còn lại: append_document_text\./);
    });
  });

  describe('mục 4 (nâng cấp) — transient tool-error auto-retry, ẩn với LLM (classifyToolError)', () => {
    afterEach(() => jest.useRealTimers());

    it('silently retries once when the error is classified as retryable (HTTP 503), succeeding on the 2nd real attempt without ever exposing the failed first attempt to the LLM', async () => {
      jest.useFakeTimers();
      mockMcpClient.callTool
        .mockResolvedValueOnce({
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                error: true,
                retryable: true,
                code: 'DYNAMIC_PROVIDER_ERROR',
                message: 'Service temporarily unavailable',
              }),
            },
          ],
          isError: true,
        })
        .mockResolvedValueOnce({
          content: [{ type: 'text', text: 'result data' }],
          isError: false,
        });
      mockSession.sendMessage
        .mockResolvedValueOnce({
          text: '',
          toolCalls: [{ name: 'get_database_schema', args: {} }],
        })
        .mockResolvedValueOnce({ text: 'ok', toolCalls: [] })
        .mockResolvedValueOnce({ text: 'vẫn giữ nguyên', toolCalls: [] });

      const runPromise = service.run(baseDto);
      await jest.advanceTimersByTimeAsync(
        ORCHESTRATION_CONSTANTS.TRANSIENT_RETRY_BACKOFF_MS + 100,
      );
      const result = await runPromise;

      // 2 lần gọi THẬT bên trong, nhưng ẩn hoàn toàn với LLM/UI.
      expect(mockMcpClient.callTool).toHaveBeenCalledTimes(2);
      const toolResultEmits = mockAgentStream.emitStep.mock.calls.filter(
        (call) => (call[1] as { type?: string })?.type === 'tool_result',
      );
      // Chỉ ĐÚNG 1 cặp tool_call/tool_result được emit ra UI — không lộ lần
      // lỗi tạm thời đầu tiên ra ngoài.
      expect(toolResultEmits).toHaveLength(1);
      expect(toolResultEmits[0][1]).toEqual({
        type: 'tool_result',
        tool: 'sql_server.get_database_schema',
        status: 'success',
        resultPreview: 'result data',
      });
      expect(result.toolCalls[0]).toEqual({
        tool: 'sql_server.get_database_schema',
        status: 'success',
        resultPreview: 'result data',
        argsPreview: '{}',
      });
    });

    it('gives up after MAX_TRANSIENT_TOOL_RETRY_ATTEMPTS and surfaces exactly 1 error tool_result, when the retryable error never clears', async () => {
      jest.useFakeTimers();
      mockMcpClient.callTool.mockResolvedValue({
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              error: true,
              retryable: true,
              code: 'DYNAMIC_PROVIDER_ERROR',
              message: 'Still down',
            }),
          },
        ],
        isError: true,
      });
      mockSession.sendMessage
        .mockResolvedValueOnce({
          text: '',
          toolCalls: [{ name: 'get_database_schema', args: {} }],
        })
        .mockResolvedValueOnce({ text: 'ok', toolCalls: [] })
        .mockResolvedValueOnce({ text: 'vẫn giữ nguyên', toolCalls: [] });

      const runPromise = service.run(baseDto);
      await jest.advanceTimersByTimeAsync(
        ORCHESTRATION_CONSTANTS.TRANSIENT_RETRY_BACKOFF_MS * 3,
      );
      const result = await runPromise;

      expect(mockMcpClient.callTool).toHaveBeenCalledTimes(
        ORCHESTRATION_CONSTANTS.MAX_TRANSIENT_TOOL_RETRY_ATTEMPTS,
      );
      const toolResultEmits = mockAgentStream.emitStep.mock.calls.filter(
        (call) => (call[1] as { type?: string })?.type === 'tool_result',
      );
      expect(toolResultEmits).toHaveLength(1);
      expect((toolResultEmits[0][1] as { status?: string }).status).toBe(
        'error',
      );
      expect(result.toolCalls[0].status).toBe('error');
    });

    it('does not retry a permanent error even when the envelope has a recognizable code but retryable: false (VD 400 — client error, not transient)', async () => {
      mockMcpClient.callTool.mockResolvedValue({
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              error: true,
              retryable: false,
              code: 'DYNAMIC_PROVIDER_ERROR',
              message: 'Bad request',
            }),
          },
        ],
        isError: true,
      });
      mockSession.sendMessage.mockResolvedValue({
        text: '',
        toolCalls: [{ name: 'get_database_schema', args: { x: 1 } }],
      });

      await service.run(baseDto);

      // Không retry transient nào — đúng 1 lần gọi thật cho bước đầu tiên,
      // các bước lặp lại sau đó bị MAX_SAME_TOOL_CALL_REPEATS chặn (khác cơ chế).
      expect(mockMcpClient.callTool).toHaveBeenCalledTimes(1);
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

    it('runs the safe tool in a mixed batch to full completion BEFORE checking the destructive one — no orphaned in-flight call left running after the approval error (bug fix: Promise.all let the destructive check reject while the safe call was still in-flight)', async () => {
      mockMcpClient.getTools.mockResolvedValue([
        {
          name: 'get_database_schema',
          description: 'desc',
          inputSchema: {},
          annotations: { readOnlyHint: true },
        },
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
          { name: 'get_database_schema', args: {} },
          {
            name: 'execute_write_query',
            args: { query: 'DELETE FROM Orders' },
          },
        ],
      });

      const error = await service.run(baseDto).catch((e) => e);

      expect(error).toBeInstanceOf(ApprovalRequiredError);
      // Tool an toàn đứng trước phải chạy XONG HẲN (kết quả nằm trong
      // toolCalls của error) trước khi tool nguy hiểm đứng sau bị chặn —
      // không phải "đang chạy dở, mồ côi" như khi dùng Promise.all.
      expect(mockMcpClient.callTool).toHaveBeenCalledTimes(1);
      expect(error.toolCalls).toEqual([
        {
          tool: 'sql_server.get_database_schema',
          status: 'success',
          resultPreview: 'result data',
          argsPreview: '{}',
        },
      ]);
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

  describe('Stop mid-stream (runCancellable + AbortSignal)', () => {
    afterEach(() => {
      jest.useRealTimers();
    });

    it('rejects with TurnCancelledError carrying whatever text had already streamed, instead of swallowing it (giống ChatGPT/Claude — Stop giữ nguyên phần đã có)', async () => {
      jest.useFakeTimers();
      mockSession.sendMessage.mockImplementation(
        (
          _input: unknown,
          onToken?: (chunk: string) => void,
          signal?: AbortSignal,
        ) => {
          onToken?.('Đang tính toán... ');
          onToken?.('sắp xong');
          // Mô phỏng đúng hành vi SDK thật: reject khi signal bị abort giữa chừng.
          return new Promise((_, reject) => {
            signal?.addEventListener('abort', () =>
              reject(new Error('aborted by signal')),
            );
          });
        },
      );
      // Cờ huỷ đã được set từ trước (user bấm Stop) — interval của
      // runCancellable() sẽ phát hiện ở lần poll đầu tiên.
      mockCancellation.isCancelled.mockResolvedValue(true);

      // Gắn assertion NGAY (trước khi advance timer) để .rejects đăng ký
      // handler trước khi promise có thể reject — tránh unhandled-rejection
      // warning do timing giữa fake timer và microtask.
      const assertion = expect(service.run(baseDto)).rejects.toMatchObject({
        name: 'TurnCancelledError',
        partialText: 'Đang tính toán... sắp xong',
      });
      await jest.advanceTimersByTimeAsync(1100); // cho interval (1s) chạy ít nhất 1 lần
      await assertion;
    });

    it('falls back to no partialText when cancelled before any token ever streamed', async () => {
      jest.useFakeTimers();
      mockSession.sendMessage.mockImplementation(
        (
          _input: unknown,
          _onToken?: (chunk: string) => void,
          signal?: AbortSignal,
        ) =>
          new Promise((_, reject) => {
            signal?.addEventListener('abort', () =>
              reject(new Error('aborted by signal')),
            );
          }),
      );
      mockCancellation.isCancelled.mockResolvedValue(true);

      const assertion = expect(service.run(baseDto)).rejects.toMatchObject({
        name: 'TurnCancelledError',
        partialText: undefined,
      });
      await jest.advanceTimersByTimeAsync(1100);
      await assertion;
    });

    // Bug thật đã sửa: Stop bấm ĐÚNG LÚC 1 tool call đang chạy (SQL query, gọi
    // API dynamic provider...) trước đây hoàn toàn vô tác dụng — signal chỉ
    // tới được sendMessage(), không tới mcpClient.callTool(). Người dùng phải
    // đợi tool tự xong (có thể tới MCP_CALL_TIMEOUT_MS=15s) mới thấy Stop có
    // tác dụng, dù đã bấm từ đầu.
    it('truyền signal xuống mcpClient.callTool() — huỷ được NGAY CẢ KHI đang giữa lúc chạy tool call, không chỉ lúc LLM đang stream', async () => {
      jest.useFakeTimers();
      mockSession.sendMessage.mockResolvedValueOnce({
        text: '',
        toolCalls: [{ name: 'get_database_schema', args: {} }],
      });
      mockMcpClient.callTool.mockImplementation(
        (_dto: unknown, signal?: AbortSignal) =>
          new Promise((_, reject) => {
            signal?.addEventListener('abort', () =>
              reject(new Error('aborted by signal')),
            );
          }),
      );
      mockCancellation.isCancelled.mockResolvedValue(true);

      const assertion = expect(service.run(baseDto)).rejects.toMatchObject({
        name: 'TurnCancelledError',
      });
      await jest.advanceTimersByTimeAsync(1100); // cho interval poll (1s) phát hiện Stop
      await assertion;

      // Không bị "nuốt" thành 1 tool_result lỗi bình thường rồi tiếp tục hỏi
      // LLM — sendMessage() chỉ được gọi đúng 1 lần (lượt tạo ra tool call),
      // KHÔNG có lượt thứ 2 nào feed "lỗi" tool này lại cho LLM.
      expect(mockSession.sendMessage).toHaveBeenCalledTimes(1);
    });

    // Bug fix (Bug 2) — TRƯỚC ĐÂY getTools()/readResource() (setup phase) chạy
    // NGOÀI runCancellable(), nên không nhận signal. Bấm Stop đúng lúc đang
    // setup thì phải đợi MCP_CALL_TIMEOUT_MS=15s trước khi Stop có hiệu lực.
    it('Bug fix #2 — Stop effective immediately during getTools() setup phase: signal is passed into setup so cancellation works without waiting for MCP_CALL_TIMEOUT_MS', async () => {
      jest.useFakeTimers();
      // Giả lập getTools() treo vô thời hạn (mô phỏng MCP server chậm)
      mockMcpClient.getTools.mockImplementation(
        (_provider: string, _query?: string, signal?: AbortSignal) =>
          new Promise((_resolve, reject) => {
            if (signal?.aborted) {
              return reject(new Error('Aborted'));
            }
            signal?.addEventListener('abort', () =>
              reject(new Error('Aborted')),
            );
          }),
      );
      mockCancellation.isCancelled.mockResolvedValue(true);

      const assertion = expect(service.run(baseDto)).rejects.toMatchObject({
        name: 'TurnCancelledError',
      });
      // Interval poll của runCancellable (1s) phát hiện Stop → abort signal
      await jest.advanceTimersByTimeAsync(1100);
      await assertion;

      // sendMessage() KHÔNG được gọi vì setup bị abort trước
      expect(mockSession.sendMessage).not.toHaveBeenCalled();
    });

    it('Bug fix #2 — Stop effective during readResource() setup: signal is forwarded to buildSystemInstruction → readResource()', async () => {
      jest.useFakeTimers();
      // getTools() hoàn thành ngay, nhưng readResource() treo
      mockMcpClient.getTools.mockResolvedValue([]);
      mockMcpClient.getResources.mockResolvedValue([
        { uri: 'file://schema', name: 'Schema' },
      ]);
      let capturedSignal: AbortSignal | undefined;
      mockMcpClient.readResource.mockImplementation(
        (_p: string, _u: string, _o?: string, signal?: AbortSignal) => {
          capturedSignal = signal;
          return new Promise((_resolve, reject) => {
            if (signal?.aborted) {
              return reject(new Error('Aborted'));
            }
            signal?.addEventListener('abort', () =>
              reject(new Error('Aborted')),
            );
          });
        },
      );
      mockCancellation.isCancelled.mockResolvedValue(true);

      const assertion = expect(service.run(baseDto)).rejects.toMatchObject({
        name: 'TurnCancelledError',
      });
      await jest.advanceTimersByTimeAsync(1100);
      await assertion;

      // Quan trọng: readResource() phải NHẬN signal từ runCancellable —
      // đây là bằng chứng signal đã được forward xuống setup phase
      expect(capturedSignal).toBeDefined();
      expect(capturedSignal).toBeInstanceOf(AbortSignal);
    });
  });
});
