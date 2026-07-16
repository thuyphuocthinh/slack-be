import { capToolResultSize } from './tool-result-size-cap.util';

describe('capToolResultSize', () => {
  it('returns the text unchanged when it is at or under the limit', () => {
    const text = 'a'.repeat(100);
    expect(capToolResultSize(text)).toBe(text);
  });

  it('cuts the text down to the limit using ContextCapper when it exceeds 6000 chars', () => {
    const text = 'a'.repeat(6001);
    const result = capToolResultSize(text);

    // ContextCapper with 6000 limit -> 3600 head, 2400 tail
    expect(result.startsWith('a'.repeat(3600))).toBe(true);
    expect(result.endsWith('a'.repeat(2400))).toBe(true);
    expect(result).toContain('[truncated 1 chars]');
  });

  it('minifies json and compresses keys for tool results', () => {
    const json = [
      { organization_id: 1, department_name: "IT" },
      { organization_id: 2, department_name: "HR" }
    ];
    const text = JSON.stringify(json, null, 2); 
    const result = capToolResultSize(text);

    expect(result).toContain('MAPPING_KEYS');
    expect(result).toContain('organization_id');
    // Result should be fully minified (no extra spaces outside of keys/values)
    expect(result).not.toContain('  ');
  });
});
