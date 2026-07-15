import { capToolResultSize } from './tool-result-size-cap.util';

describe('capToolResultSize', () => {
  it('returns the text unchanged when it is at or under the limit', () => {
    const text = 'a'.repeat(100);

    expect(capToolResultSize(text, 100)).toBe(text);
  });

  it('cuts the text down to the limit and appends a note explaining the original size', () => {
    const text = 'a'.repeat(200);

    const result = capToolResultSize(text, 100);

    expect(result.startsWith('a'.repeat(100))).toBe(true);
    expect(result).toContain('ĐÃ CẮT BỚT');
    expect(result).toContain('200 ký tự');
    expect(result).toContain('100 ký tự đầu');
  });

  it('uses the default 6000-char limit when none is given', () => {
    const text = 'a'.repeat(6001);

    const result = capToolResultSize(text);

    expect(result.startsWith('a'.repeat(6000))).toBe(true);
    expect(result).toContain('6001 ký tự');
  });
});
