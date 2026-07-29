import { Logger } from '@nestjs/common';
import { checkQuantity } from './quantity-check.util';

describe('checkQuantity', () => {
  const mockStrategy = { id: 'openai', generateStructured: jest.fn() };
  const mockCircuitBreaker = {
    run: jest.fn((_key: string, action: () => Promise<unknown>) => action()),
  };
  const logger = new Logger('test');

  afterEach(() => jest.clearAllMocks());

  it('returns requiredCount=0 without an achieved-count call when the task states no explicit quantity', async () => {
    mockStrategy.generateStructured.mockResolvedValueOnce({ requiredCount: 0 });

    const result = await checkQuantity(
      'xem schema bảng Customers',
      '',
      mockStrategy,
      'gpt-4o-mini',
      mockCircuitBreaker as any,
      logger,
    );

    expect(result).toEqual({ requiredCount: 0, achievedCount: 0 });
    expect(mockStrategy.generateStructured).toHaveBeenCalledTimes(1);
  });

  it('returns both counts when the task states an explicit quantity', async () => {
    mockStrategy.generateStructured
      .mockResolvedValueOnce({ requiredCount: 5 })
      .mockResolvedValueOnce({ achievedCount: 1 });

    const result = await checkQuantity(
      'tạo 5 sản phẩm ngẫu nhiên',
      'sql_server.execute_write_query: 1 row inserted',
      mockStrategy,
      'gpt-4o-mini',
      mockCircuitBreaker as any,
      logger,
    );

    expect(result).toEqual({ requiredCount: 5, achievedCount: 1 });
  });

  it('treats an LLM failure as not-applicable instead of throwing', async () => {
    mockStrategy.generateStructured.mockRejectedValueOnce(new Error('down'));

    const result = await checkQuantity(
      'tạo 5 sản phẩm ngẫu nhiên',
      '',
      mockStrategy,
      'gpt-4o-mini',
      mockCircuitBreaker as any,
      logger,
    );

    expect(result).toEqual({ requiredCount: 0, achievedCount: 0 });
  });
});
