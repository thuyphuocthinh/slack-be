import { Logger } from '@nestjs/common';
import { ToolRiskGate } from './tool-risk-gate';
import { InsertAccumulator } from './insert-accumulator';
import { RunReactLoopRequestDto } from '../dto/react-loop.dto';
import { McpToolDto } from '../dto/mcp.dto';
import { LlmStrategy } from './strategy/llm-strategy.interface';
import { CircuitBreakerService } from '../common/circuit-breaker.service';

describe('ToolRiskGate', () => {
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

  const logger = { warn: jest.fn(), log: jest.fn() } as unknown as Logger;
  const circuitBreaker = {
    run: jest.fn((_key: string, action: () => Promise<unknown>) => action()),
  } as unknown as CircuitBreakerService;

  function createStrategy(): LlmStrategy {
    return {
      id: 'test-strategy',
      startChat: jest.fn(),
      generateStructured: jest.fn(),
    };
  }

  function createGate(
    overrides: Partial<{
      dto: RunReactLoopRequestDto;
      mcpTools: McpToolDto[];
      strategy: LlmStrategy;
    }> = {},
  ) {
    const strategy = overrides.strategy ?? createStrategy();
    const gate = new ToolRiskGate({
      dto: overrides.dto ?? baseDto,
      mcpTools: overrides.mcpTools ?? [],
      strategy,
      model: 'gemini-2.0-flash',
      circuitBreaker,
      logger,
      signal: new AbortController().signal,
      insertAccumulator: new InsertAccumulator(),
    });
    return { gate, strategy };
  }

  afterEach(() => jest.clearAllMocks());

  describe('isDestructive()', () => {
    it('trả true khi mcpTools khai destructiveHint cho đúng tool đó', () => {
      const { gate } = createGate({
        mcpTools: [
          {
            name: 'execute_write_query',
            description: 'desc',
            inputSchema: {},
            annotations: { destructiveHint: true },
          },
        ],
      });

      expect(gate.isDestructive('execute_write_query')).toBe(true);
    });

    it('trả false khi tool không có destructiveHint hoặc không có trong mcpTools', () => {
      const { gate } = createGate({
        mcpTools: [
          { name: 'get_database_schema', description: 'desc', inputSchema: {} },
        ],
      });

      expect(gate.isDestructive('get_database_schema')).toBe(false);
      expect(gate.isDestructive('unknown_tool')).toBe(false);
    });
  });

  describe('isAutoApprovableInsert()', () => {
    it('trả true cho execute_write_query của sql_server với câu INSERT thật', () => {
      const { gate } = createGate();

      expect(
        gate.isAutoApprovableInsert('execute_write_query', {
          query: "INSERT INTO Products (Name) VALUES ('A')",
        }),
      ).toBe(true);
    });

    it('trả false khi provider không phải sql_server', () => {
      const { gate } = createGate({ dto: { ...baseDto, provider: 'github' } });

      expect(
        gate.isAutoApprovableInsert('execute_write_query', {
          query: "INSERT INTO Products (Name) VALUES ('A')",
        }),
      ).toBe(false);
    });

    it('trả false cho tool khác execute_write_query', () => {
      const { gate } = createGate();

      expect(
        gate.isAutoApprovableInsert('some_other_tool', {
          query: "INSERT INTO Products (Name) VALUES ('A')",
        }),
      ).toBe(false);
    });

    it('trả false khi câu lệnh không phải INSERT (VD UPDATE/DELETE)', () => {
      const { gate } = createGate();

      expect(
        gate.isAutoApprovableInsert('execute_write_query', {
          query: "UPDATE Orders SET Status='Done' WHERE OrderId=1",
        }),
      ).toBe(false);
    });

    it('trả false khi args không có query dạng string', () => {
      const { gate } = createGate();

      expect(gate.isAutoApprovableInsert('execute_write_query', {})).toBe(
        false,
      );
    });
  });

  describe('checkBulkInsertShortfall()', () => {
    it('trả null ngay khi tool/câu lệnh không giống create/insert (không cần gọi LLM đếm requiredCount)', async () => {
      const { gate, strategy } = createGate();

      const result = await gate.checkBulkInsertShortfall(
        'sql_server.execute_read_only_query',
        'SELECT * FROM Products',
        { query: 'SELECT * FROM Products' },
      );

      expect(result).toBeNull();
      expect(strategy.generateStructured).not.toHaveBeenCalled();
    });

    it('trả null khi getRequiredCount() (LLM) trả về 0 — task không có yêu cầu số lượng cụ thể', async () => {
      const strategy = createStrategy();
      (strategy.generateStructured as jest.Mock).mockResolvedValue({
        requiredCount: 0,
      });
      const { gate } = createGate({ strategy });
      const query = "INSERT INTO Products (Name) VALUES ('A')";

      const result = await gate.checkBulkInsertShortfall(
        'sql_server.execute_write_query',
        query,
        { query },
      );

      expect(result).toBeNull();
    });

    it('trả shortfallMessage khi số tuple gộp được vẫn ít hơn requiredCount', async () => {
      const strategy = createStrategy();
      (strategy.generateStructured as jest.Mock).mockResolvedValue({
        requiredCount: 5,
      });
      const { gate } = createGate({ strategy });
      const query = "INSERT INTO Products (Name) VALUES ('A')";
      const args = { query };

      const result = await gate.checkBulkInsertShortfall(
        'sql_server.execute_write_query',
        query,
        args,
      );

      expect(result).toContain('1/5');
      expect(args.query).toBe(query); // KHÔNG bị ghi đè khi còn thiếu
    });

    it('gộp tuple tích luỹ đủ requiredCount thì ghi đè args.query và trả null (cho phép auto-approve chạy)', async () => {
      const strategy = createStrategy();
      (strategy.generateStructured as jest.Mock).mockResolvedValue({
        requiredCount: 2,
      });
      const { gate } = createGate({ strategy });
      const argsA = { query: "INSERT INTO Products (Name) VALUES ('A')" };
      const argsB = { query: "INSERT INTO Products (Name) VALUES ('B')" };

      const first = await gate.checkBulkInsertShortfall(
        'sql_server.execute_write_query',
        argsA.query,
        argsA,
      );
      expect(first).not.toBeNull();

      const second = await gate.checkBulkInsertShortfall(
        'sql_server.execute_write_query',
        argsB.query,
        argsB,
      );

      expect(second).toBeNull();
      expect(argsB.query).toBe(
        "INSERT INTO Products (Name) VALUES ('A'), ('B')",
      );
    });
  });

  describe('clearAccumulatorFor()', () => {
    it('xoá tuple đã gộp cho bảng đó — lần checkBulkInsertShortfall() sau bắt đầu lại từ đầu', async () => {
      const strategy = createStrategy();
      (strategy.generateStructured as jest.Mock).mockResolvedValue({
        requiredCount: 5,
      });
      const { gate } = createGate({ strategy });
      const query = "INSERT INTO Products (Name) VALUES ('A')";
      await gate.checkBulkInsertShortfall(
        'sql_server.execute_write_query',
        query,
        { query },
      );

      gate.clearAccumulatorFor(query);

      const afterClear = await gate.checkBulkInsertShortfall(
        'sql_server.execute_write_query',
        "INSERT INTO Products (Name) VALUES ('B')",
        { query: "INSERT INTO Products (Name) VALUES ('B')" },
      );
      expect(afterClear).toContain('1/5');
    });
  });
});
