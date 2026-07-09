import { ResponseTruncatorUtil } from './response-truncator.util';

describe('ResponseTruncatorUtil', () => {
  it('should truncate long strings', () => {
    const longString = 'A'.repeat(1500);
    const data = { content: longString };
    const truncated = ResponseTruncatorUtil.truncate(data, 1000, 50);
    
    expect(truncated.content.length).toBeLessThan(1500);
    expect(truncated.content).toContain('[TRUNCATED_DUE_TO_SIZE: original length was 1500]');
    expect(truncated.content.startsWith('A'.repeat(1000))).toBe(true);
  });

  it('should truncate large arrays', () => {
    const data = { items: Array.from({ length: 100 }, (_, i) => i) };
    const truncated = ResponseTruncatorUtil.truncate(data, 1000, 10);
    
    expect(truncated.items.length).toBe(11); // 10 items + 1 warning message
    expect(truncated.items[10]).toContain('WARNING: Array truncated from 100 to 10 items');
  });
});
