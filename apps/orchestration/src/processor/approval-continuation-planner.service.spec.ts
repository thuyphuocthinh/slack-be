import { Test, TestingModule } from '@nestjs/testing';
import { ORCHESTRATION_CONSTANTS } from '@slack/constants';
import { ApprovalContinuationPlannerService } from './approval-continuation-planner.service';
import { LlmStrategyFactory } from '../llm/strategy/llm-strategy.factory';
import { CircuitBreakerService } from '../common/circuit-breaker.service';

describe('ApprovalContinuationPlannerService (ver3.md mục 3 — quantity-check after approval)', () => {
  let service: ApprovalContinuationPlannerService;

  const mockStrategy = { id: 'openai', generateStructured: jest.fn() };
  const mockLlmFactory = { resolve: jest.fn() };
  const mockCircuitBreaker = {
    run: jest.fn((_key: string, action: () => Promise<unknown>) => action()),
  };

  const checkpoint = {
    id: 'checkpoint-1',
    pendingTool: {
      provider: 'sql_server',
      name: 'execute_write_query',
      args: { query: "INSERT INTO Products VALUES ('A')" },
    },
    pendingTask: 'Tạo 5 sản phẩm ngẫu nhiên rồi chèn vào bảng Products',
    roundsSoFar: [] as { agent: string; task: string; result: string }[],
    remainingSteps: undefined,
  } as any;

  beforeEach(async () => {
    mockLlmFactory.resolve.mockReturnValue({
      strategy: mockStrategy,
      model: 'gpt-4o-mini',
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ApprovalContinuationPlannerService,
        { provide: LlmStrategyFactory, useValue: mockLlmFactory },
        { provide: CircuitBreakerService, useValue: mockCircuitBreaker },
      ],
    }).compile();

    service = module.get<ApprovalContinuationPlannerService>(
      ApprovalContinuationPlannerService,
    );
  });

  afterEach(() => jest.clearAllMocks());

  it('prepends a continuation step when the achieved count falls short', async () => {
    mockStrategy.generateStructured
      .mockResolvedValueOnce({ requiredCount: 5 })
      .mockResolvedValueOnce({ achievedCount: 1 });

    const { remainingSteps } = await service.resolveRemainingSteps(
      { ...checkpoint, roundsSoFar: [] },
      '1 row inserted',
    );

    expect(remainingSteps).toHaveLength(1);
    expect(remainingSteps![0].agent).toBe('sql_server');
    expect(remainingSteps![0].task).toContain('Đã xử lý 1/5');
  });

  it('tells the model to batch the remaining rows into a single tool call (manual_test_bank.md V1/V2 — avoid 1 approval round per row)', async () => {
    mockStrategy.generateStructured
      .mockResolvedValueOnce({ requiredCount: 20 })
      .mockResolvedValueOnce({ achievedCount: 1 });

    const { remainingSteps } = await service.resolveRemainingSteps(
      { ...checkpoint, roundsSoFar: [] },
      '1 row inserted',
    );

    expect(remainingSteps![0].task).toContain(
      'gộp TOÀN BỘ 19 phần còn thiếu vào ĐÚNG 1 lần gọi tool duy nhất',
    );
  });

  it('leaves remainingSteps untouched when the achieved count already matches', async () => {
    mockStrategy.generateStructured
      .mockResolvedValueOnce({ requiredCount: 5 })
      .mockResolvedValueOnce({ achievedCount: 5 });

    const { remainingSteps, resultText } = await service.resolveRemainingSteps(
      { ...checkpoint, roundsSoFar: [] },
      '1 row inserted',
    );

    expect(remainingSteps).toEqual(checkpoint.remainingSteps);
    expect(resultText).toBe('1 row inserted');
  });

  it('does not count an UNRELATED earlier round using the same agent toward the continuation cap (bug fix)', async () => {
    mockStrategy.generateStructured
      .mockResolvedValueOnce({ requiredCount: 5 })
      .mockResolvedValueOnce({ achievedCount: 1 });

    const { remainingSteps } = await service.resolveRemainingSteps(
      {
        ...checkpoint,
        roundsSoFar: [
          {
            agent: 'sql_server',
            task: 'kiểm tra số lượng khách hàng inactive',
            result: '120 khách hàng',
          },
        ],
      },
      '1 row inserted',
    );

    // Round không liên quan (task khác hẳn) KHÔNG được tính vào "đã thử mấy
    // lần" — vẫn còn dư budget để chèn tiếp, không chạm cap ngay lập tức.
    expect(remainingSteps).toHaveLength(1);
    expect(remainingSteps![0].task).toContain('Đã xử lý 1/5');
  });

  it('stops nudging once MAX_QUANTITY_CONTINUATION_ROUNDS is reached, but still warns instead of silently claiming done', async () => {
    const priorAttempts =
      ORCHESTRATION_CONSTANTS.MAX_QUANTITY_CONTINUATION_ROUNDS - 1;
    mockStrategy.generateStructured
      .mockResolvedValueOnce({ requiredCount: 5 })
      .mockResolvedValueOnce({ achievedCount: 1 });

    const { remainingSteps, resultText } = await service.resolveRemainingSteps(
      {
        ...checkpoint,
        roundsSoFar: Array.from({ length: priorAttempts }, () => ({
          agent: 'sql_server',
          task: checkpoint.pendingTask,
          result: '1',
        })),
      },
      '1 row inserted',
    );

    expect(resultText).toContain(
      `mới xử lý được 1 sau ${ORCHESTRATION_CONSTANTS.MAX_QUANTITY_CONTINUATION_ROUNDS} lần thử`,
    );
    expect(remainingSteps).toEqual(checkpoint.remainingSteps);
  });
});
