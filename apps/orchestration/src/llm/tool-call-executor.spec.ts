import { Logger } from '@nestjs/common';
import {
  ORCHESTRATION_CONSTANTS,
  EStepExecutionStatus,
} from '@slack/constants';
import { ToolCallExecutor } from './tool-call-executor';
import { ToolRepeatGuard } from './tool-repeat-guard';
import { InsertAccumulator } from './insert-accumulator';
import { ToolRiskGate } from './tool-risk-gate';
import { ApprovalRequiredError } from './approval-required.error';
import { RunReactLoopRequestDto } from '../dto/react-loop.dto';
import { McpToolDto } from '../dto/mcp.dto';

// @slack/common barrel transitively kéo theo "nanoid" (ESM-only) qua
// string.util.ts — jest không transform được, mock thẳng theo đúng convention
// đã dùng ở react-loop.service.spec.ts thay vì để jest parse cả barrel thật.
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

describe('ToolCallExecutor', () => {
  const baseDto: RunReactLoopRequestDto = {
    prompt: 'tạo 5 sản phẩm mới',
    provider: 'sql_server',
    userId: 'user-1',
    channelId: 'channel-1',
    workspaceId: 'workspace-1',
    messageId: 'reply-msg-1',
    channelType: 'direct',
    history: [],
  };

  const mockMcpClient = { callTool: jest.fn() };
  const mockAgentStream = { emitStep: jest.fn() };
  const mockMemoryManager = {
    buildBudget: jest.fn().mockReturnValue({ toolResultCharBudget: 100_000 }),
  };
  const logger = { log: jest.fn(), warn: jest.fn() } as unknown as Logger;

  function createExecutor(
    options: {
      dto?: RunReactLoopRequestDto;
      mcpTools?: McpToolDto[];
      riskGate?: Partial<ToolRiskGate>;
      insertAccumulator?: InsertAccumulator;
    } = {},
  ) {
    const riskGate = {
      isDestructive: jest.fn().mockReturnValue(false),
      isAutoApprovableInsert: jest.fn().mockReturnValue(false),
      checkBulkInsertShortfall: jest.fn().mockResolvedValue(null),
      clearAccumulatorFor: jest.fn(),
      ...options.riskGate,
    } as unknown as ToolRiskGate;

    const executor = new ToolCallExecutor(
      {
        dto: options.dto ?? baseDto,
        mcpTools: options.mcpTools ?? [],
        reactModelId: 'gemini-2.0-flash',
        signal: new AbortController().signal,
      },
      {
        mcpClient: mockMcpClient as any,
        agentStream: mockAgentStream as any,
        memoryManager: mockMemoryManager as any,
        logger,
        repeatGuard: new ToolRepeatGuard(),
        insertAccumulator: options.insertAccumulator ?? new InsertAccumulator(),
        riskGate,
      },
    );
    return { executor, riskGate };
  }

  beforeEach(() => {
    mockMcpClient.callTool.mockResolvedValue({
      content: [{ type: 'text', text: 'result data' }],
      isError: false,
    });
    mockAgentStream.emitStep.mockResolvedValue(undefined);
  });

  afterEach(() => jest.clearAllMocks());

  it('runs independent tool calls (khác tên/tham số) trong CÙNG 1 lượt CONCURRENTLY', async () => {
    const { executor } = createExecutor();
    let activeCalls = 0;
    let maxConcurrent = 0;
    mockMcpClient.callTool.mockImplementation(async () => {
      activeCalls++;
      maxConcurrent = Math.max(maxConcurrent, activeCalls);
      await new Promise((resolve) => setTimeout(resolve, 20));
      activeCalls--;
      return { content: [{ type: 'text', text: 'data' }], isError: false };
    });

    await executor.run([
      { name: 'get_table1', args: {} },
      { name: 'get_table2', args: {} },
    ]);

    expect(maxConcurrent).toBe(2);
  });

  it('xếp hàng 2 INSERT nhắm CÙNG bảng thay vì để race trên insertAccumulator dùng chung', async () => {
    const insertAccumulator = new InsertAccumulator();
    const { executor } = createExecutor({
      insertAccumulator,
      riskGate: {
        isDestructive: jest.fn().mockReturnValue(true),
        isAutoApprovableInsert: jest.fn().mockReturnValue(true),
      },
    });
    let activeCalls = 0;
    let maxConcurrent = 0;
    mockMcpClient.callTool.mockImplementation(async () => {
      activeCalls++;
      maxConcurrent = Math.max(maxConcurrent, activeCalls);
      await new Promise((resolve) => setTimeout(resolve, 20));
      activeCalls--;
      return { content: [{ type: 'text', text: 'data' }], isError: false };
    });

    await executor.run([
      {
        name: 'execute_write_query',
        args: { query: "INSERT INTO Products (Name) VALUES ('A')" },
      },
      {
        name: 'execute_write_query',
        args: { query: "INSERT INTO Products (Name) VALUES ('B')" },
      },
    ]);

    expect(maxConcurrent).toBe(1);
    expect(mockMcpClient.callTool).toHaveBeenCalledTimes(2);
  });

  it('phục vụ lần gọi lặp lại ĐÚNG tham số từ cache thay vì gọi tool thật lần 2', async () => {
    const { executor } = createExecutor();

    await executor.run([
      { name: 'get_database_schema', args: { x: 1 } },
      { name: 'get_database_schema', args: { x: 1 } },
    ]);

    expect(mockMcpClient.callTool).toHaveBeenCalledTimes(1);
    expect(executor.getToolCalls().every((tc) => tc.status === 'success')).toBe(
      true,
    );
  });

  it('chặn lần gọi lặp lại (không cache vì lần đầu lỗi) sau khi vượt MAX_SAME_TOOL_CALL_REPEATS', async () => {
    mockMcpClient.callTool.mockResolvedValue({
      content: [{ type: 'text', text: 'HTTP 500 upstream error' }],
      isError: true,
    });
    const { executor } = createExecutor();

    await executor.run([{ name: 'get_database_schema', args: { x: 1 } }]);
    await executor.run([{ name: 'get_database_schema', args: { x: 1 } }]);

    expect(mockMcpClient.callTool).toHaveBeenCalledTimes(1);
    const blocked = executor.getToolCalls()[1];
    expect(blocked.status).toBe('error');
    expect(blocked.resultPreview).toContain('đã được gọi với ĐÚNG tham số này');
  });

  it('tự thử lại NGẦM lỗi tạm thời (retryable), thành công ở lần 2 mà không lộ lần lỗi đầu ra ngoài', async () => {
    jest.useFakeTimers();
    mockMcpClient.callTool
      .mockResolvedValueOnce({
        content: [
          {
            type: 'text',
            text: JSON.stringify({ error: true, retryable: true }),
          },
        ],
        isError: true,
      })
      .mockResolvedValueOnce({
        content: [{ type: 'text', text: 'result data' }],
        isError: false,
      });
    const { executor } = createExecutor();

    const runPromise = executor.run([
      { name: 'get_database_schema', args: {} },
    ]);
    await jest.advanceTimersByTimeAsync(
      ORCHESTRATION_CONSTANTS.TRANSIENT_RETRY_BACKOFF_MS + 100,
    );
    await runPromise;

    expect(mockMcpClient.callTool).toHaveBeenCalledTimes(2);
    expect(executor.getToolCalls()).toHaveLength(1);
    expect(executor.getToolCalls()[0].status).toBe('success');
    jest.useRealTimers();
  });

  it('scrubs PII/secrets khỏi exception message trước khi ghi trace/trả về', async () => {
    const rawToken =
      'eyJhbGciOiJIUzI1NiIsInR5cCI.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
    mockMcpClient.callTool.mockRejectedValueOnce(
      new Error(`Unauthorized, request had header: ${rawToken}`),
    );
    const { executor } = createExecutor();

    const [result] = await executor.run([
      { name: 'get_database_schema', args: {} },
    ]);

    expect(result.content).not.toContain(rawToken);
    expect(executor.getToolCalls()[0].resultPreview).not.toContain(rawToken);
    expect(executor.getToolCalls()[0].resultPreview).toContain(
      '[JWT_TOKEN_REDACTED]',
    );
  });

  describe('Risk Gate delegation (ToolCallExecutor <- ToolRiskGate)', () => {
    it('khi checkBulkInsertShortfall() trả message: ghi lỗi vào trace và KHÔNG gọi tool thật', async () => {
      const { executor, riskGate } = createExecutor({
        riskGate: {
          isDestructive: jest.fn().mockReturnValue(true),
          checkBulkInsertShortfall: jest
            .fn()
            .mockResolvedValue('Đã ghi nhận 1/5 dòng yêu cầu.'),
        },
      });

      const [result] = await executor.run([
        {
          name: 'execute_write_query',
          args: { query: "INSERT INTO Products (Name) VALUES ('A')" },
        },
      ]);

      expect(mockMcpClient.callTool).not.toHaveBeenCalled();
      expect(result.content).toBe('Đã ghi nhận 1/5 dòng yêu cầu.');
      expect(executor.getToolCalls()[0].status).toBe(
        EStepExecutionStatus.ERROR,
      );
      expect(riskGate.isAutoApprovableInsert).not.toHaveBeenCalled();
    });

    it('khi isAutoApprovableInsert() trả true: tự chạy tool thật rồi clearAccumulatorFor() câu lệnh đã dùng', async () => {
      const { executor, riskGate } = createExecutor({
        riskGate: {
          isDestructive: jest.fn().mockReturnValue(true),
          isAutoApprovableInsert: jest.fn().mockReturnValue(true),
        },
      });
      const query = "INSERT INTO Products (Name) VALUES ('A')";

      await executor.run([{ name: 'execute_write_query', args: { query } }]);

      expect(mockMcpClient.callTool).toHaveBeenCalledTimes(1);
      expect(riskGate.clearAccumulatorFor).toHaveBeenCalledWith(query);
      expect(executor.getToolCalls()[0].status).toBe('success');
    });

    it('khi không shortfall và không auto-approve: throw ApprovalRequiredError, KHÔNG gọi tool thật', async () => {
      const { executor } = createExecutor({
        riskGate: { isDestructive: jest.fn().mockReturnValue(true) },
      });

      await expect(
        executor.run([
          {
            name: 'execute_write_query',
            args: { query: "UPDATE Orders SET Status='Done' WHERE Id=1" },
          },
        ]),
      ).rejects.toThrow(ApprovalRequiredError);
      expect(mockMcpClient.callTool).not.toHaveBeenCalled();
    });
  });
});
