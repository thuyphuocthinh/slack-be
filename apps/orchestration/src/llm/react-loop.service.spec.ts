import { Test, TestingModule } from '@nestjs/testing';
import { ORCHESTRATION_CONSTANTS, ORCHESTRATION_SELF_CHECK_PROMPT } from '@slack/constants';
import { ReactLoopService } from './react-loop.service';
import { McpClientService } from '../mcp/mcp-client.service';
import { MessageClientService } from '../message-client.service';
import { LlmStrategyFactory } from './strategy/llm-strategy.factory';
import { AgentStreamService } from '../socket/agent-stream.service';
import { RunReactLoopRequestDto } from '../dto/react-loop.dto';

// @slack/common barrel transitively kéo theo "nanoid" (ESM-only) qua
// string.util.ts — jest không transform được, mock thẳng theo đúng convention
// đã dùng ở auth.service.spec.ts thay vì để jest parse cả barrel thật.
jest.mock('@slack/common', () => ({
  extractTextFromMcpResult: jest.fn((result?: { content?: { type: string; text?: string }[] }) => {
    if (!result?.content?.length) return '';
    return result.content
      .filter((c) => c.type === 'text' && c.text)
      .map((c) => c.text)
      .join('\n');
  }),
}));

describe('ReactLoopService', () => {
  let service: ReactLoopService;

  const mockMcpClient = { getTools: jest.fn(), callTool: jest.fn() };
  const mockMessageClient = { getRecentHistory: jest.fn() };
  const mockAgentStream = { emitStep: jest.fn() };
  const mockSession = { sendMessage: jest.fn() };
  const mockStrategy = { startChat: jest.fn().mockReturnValue(mockSession) };
  const mockLlmFactory = { resolve: jest.fn().mockReturnValue({ strategy: mockStrategy, model: 'gemini-2.0-flash' }) };

  const baseDto: RunReactLoopRequestDto = {
    prompt: 'có bao nhiêu bảng trong DB?',
    provider: 'sql_server',
    userId: 'user-1',
    channelId: 'channel-1',
    workspaceId: 'workspace-1',
    messageId: 'reply-msg-1',
    triggerMessageId: 'trigger-msg-1',
    channelType: 'direct',
  };

  beforeEach(async () => {
    mockMcpClient.getTools.mockResolvedValue([{ name: 'get_database_schema', description: 'desc', inputSchema: {} }]);
    mockMessageClient.getRecentHistory.mockResolvedValue([]);
    mockMcpClient.callTool.mockResolvedValue({ content: [{ type: 'text', text: 'result data' }], isError: false });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReactLoopService,
        { provide: McpClientService, useValue: mockMcpClient },
        { provide: MessageClientService, useValue: mockMessageClient },
        { provide: LlmStrategyFactory, useValue: mockLlmFactory },
        { provide: AgentStreamService, useValue: mockAgentStream },
      ],
    }).compile();

    service = module.get<ReactLoopService>(ReactLoopService);
  });

  afterEach(() => jest.clearAllMocks());

  it('returns the answer immediately when the model never calls a tool', async () => {
    mockSession.sendMessage.mockResolvedValueOnce({ text: 'Xin chào!', toolCalls: [] });

    const result = await service.run(baseDto);

    expect(result).toEqual({ answer: 'Xin chào!', toolCalls: [] });
    expect(mockSession.sendMessage).toHaveBeenCalledTimes(1);
    // Không tool call nào chạy — không có step nào phát ra. Tín hiệu "done"
    // giờ do AiOrchestrationProcessor lo, KHÔNG phải trách nhiệm của ReactLoopService.
    expect(mockAgentStream.emitStep).not.toHaveBeenCalled();
  });

  it('runs the self-check nudge exactly once after the model stops calling tools', async () => {
    mockSession.sendMessage
      .mockResolvedValueOnce({ text: '', toolCalls: [{ name: 'get_database_schema', args: {} }] })
      .mockResolvedValueOnce({ text: 'Đây là schema.', toolCalls: [] })
      .mockResolvedValueOnce({ text: 'Xác nhận đã đủ dữ liệu.', toolCalls: [] });

    const result = await service.run(baseDto);

    expect(result.answer).toBe('Xác nhận đã đủ dữ liệu.');
    // tool namespace theo "{provider}.{toolName}" (Step 6) — tránh lẫn lộn
    // khi 1 turn gộp toolCalls từ nhiều agent khác nhau.
    expect(result.toolCalls).toEqual([{ tool: 'sql_server.get_database_schema', status: 'success', resultPreview: 'result data' }]);
    expect(mockSession.sendMessage).toHaveBeenCalledTimes(3);
    expect(mockSession.sendMessage).toHaveBeenNthCalledWith(3, ORCHESTRATION_SELF_CHECK_PROMPT);
  });

  it('does not nudge a second time — stops after exactly one self-check round', async () => {
    mockSession.sendMessage
      .mockResolvedValueOnce({ text: '', toolCalls: [{ name: 'get_database_schema', args: {} }] })
      .mockResolvedValueOnce({ text: 'chưa chắc lắm', toolCalls: [] })
      .mockResolvedValueOnce({ text: 'vẫn giữ nguyên câu trả lời', toolCalls: [] });

    await service.run(baseDto);

    // 1 initial + 1 sau tool call + 1 self-check = 3, không có lượt nudge thứ 2
    expect(mockSession.sendMessage).toHaveBeenCalledTimes(3);
  });

  it('stops after MAX_REACT_STEPS iterations and returns the fallback message if the model never converges', async () => {
    mockSession.sendMessage.mockResolvedValue({ text: '', toolCalls: [{ name: 'get_database_schema', args: {} }] });

    const result = await service.run(baseDto);

    expect(result.answer).toBe('Xin lỗi, câu hỏi này cần nhiều bước hơn mình hỗ trợ được.');
    expect(mockMcpClient.callTool).toHaveBeenCalledTimes(ORCHESTRATION_CONSTANTS.MAX_REACT_STEPS);
    // 1 lượt gọi ban đầu + đúng MAX_REACT_STEPS lượt trong loop
    expect(mockSession.sendMessage).toHaveBeenCalledTimes(ORCHESTRATION_CONSTANTS.MAX_REACT_STEPS + 1);
  });

  it('starts the chat with a low temperature (Step 7 — anti-hallucination for tool calls)', async () => {
    mockSession.sendMessage.mockResolvedValueOnce({ text: 'ok', toolCalls: [] });

    await service.run(baseDto);

    expect(mockStrategy.startChat).toHaveBeenCalledWith(
      expect.objectContaining({ temperature: ORCHESTRATION_CONSTANTS.REACT_LOOP_TEMPERATURE }),
    );
  });

  it('resolves the model via LlmStrategyFactory using dto.model when provided, falling back to the default otherwise', async () => {
    mockSession.sendMessage.mockResolvedValueOnce({ text: 'ok', toolCalls: [] });

    await service.run({ ...baseDto, model: 'gpt-4o-mini' });
    expect(mockLlmFactory.resolve).toHaveBeenCalledWith('gpt-4o-mini');

    mockSession.sendMessage.mockResolvedValueOnce({ text: 'ok', toolCalls: [] });
    await service.run(baseDto);
    expect(mockLlmFactory.resolve).toHaveBeenCalledWith(ORCHESTRATION_CONSTANTS.DEFAULT_REACT_MODEL);
  });

  describe('tool step streaming (via AgentStreamService)', () => {
    it('emits tool_call then tool_result with the reply messageId/channel context, in order', async () => {
      mockSession.sendMessage
        .mockResolvedValueOnce({ text: '', toolCalls: [{ name: 'get_database_schema', args: {} }] })
        .mockResolvedValueOnce({ text: 'ok', toolCalls: [] })
        .mockResolvedValueOnce({ text: 'vẫn giữ nguyên', toolCalls: [] }); // self-check round

      await service.run({ ...baseDto, channelType: 'group' });

      expect(mockAgentStream.emitStep).toHaveBeenNthCalledWith(
        1,
        { userId: 'user-1', channelId: 'channel-1', messageId: 'reply-msg-1', channelType: 'group' },
        { type: 'tool_call', tool: 'sql_server.get_database_schema' },
      );
      expect(mockAgentStream.emitStep).toHaveBeenNthCalledWith(
        2,
        { userId: 'user-1', channelId: 'channel-1', messageId: 'reply-msg-1', channelType: 'group' },
        { type: 'tool_result', tool: 'sql_server.get_database_schema', status: 'success', resultPreview: 'result data' },
      );
      // "done" KHÔNG phải việc của ReactLoopService nữa
      expect(mockAgentStream.emitStep).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ type: 'done' }));
    });

    it('namespaces the tool name by dto.provider, not hard-coded (Step 6 — avoid collisions across agents)', async () => {
      mockSession.sendMessage
        .mockResolvedValueOnce({ text: '', toolCalls: [{ name: 'list_issues', args: {} }] })
        .mockResolvedValueOnce({ text: 'ok', toolCalls: [] })
        .mockResolvedValueOnce({ text: 'vẫn giữ nguyên', toolCalls: [] });

      const result = await service.run({ ...baseDto, provider: 'github' });

      expect(result.toolCalls).toEqual([{ tool: 'github.list_issues', status: 'success', resultPreview: 'result data' }]);
      // Gọi MCP server thật vẫn dùng đúng tên gốc "list_issues", KHÔNG bị namespace
      expect(mockMcpClient.callTool).toHaveBeenCalledWith(
        expect.objectContaining({ provider: 'github', name: 'list_issues' }),
      );
    });

    it('marks the step as "error" when the MCP tool call itself errors out', async () => {
      mockMcpClient.callTool.mockResolvedValue({ content: [{ type: 'text', text: 'DB connection failed' }], isError: true });
      mockSession.sendMessage
        .mockResolvedValueOnce({ text: '', toolCalls: [{ name: 'get_database_schema', args: {} }] })
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
  });
});
