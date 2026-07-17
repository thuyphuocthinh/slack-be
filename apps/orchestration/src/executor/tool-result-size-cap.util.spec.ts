import { capToolResultSize } from './tool-result-size-cap.util';

describe('capToolResultSize', () => {
  it('returns the text unchanged when it is at or under the limit', () => {
    const text = 'a'.repeat(100);
    expect(capToolResultSize(text)).toBe(text);
  });

  it('cuts the text down to the limit using ContextCapper when it exceeds 6000 chars', () => {
    const text = 'a'.repeat(6001);
    const result = capToolResultSize(text);

    // ContextCapper reserves 40 chars for its own truncation marker out of the
    // 6000 budget -> effective 5960 -> 3576 head, 2384 tail. This keeps the
    // capper's own output under MAX_TOOL_RESULT_CHARS so the outer safety net
    // does not fire a second time on top of it.
    expect(result.startsWith('a'.repeat(3576))).toBe(true);
    expect(result.endsWith('a'.repeat(2384))).toBe(true);
    // 6001 chars in, 3576 head + 2384 tail kept -> 41 chars actually dropped
    expect(result).toContain('[truncated 41 chars]');
    expect(result.length).toBeLessThanOrEqual(6000);
  });

  it('minifies json but skips key compression when the payload is already small', () => {
    const json = [
      { organization_id: 1, department_name: "IT" },
      { organization_id: 2, department_name: "HR" }
    ];
    const text = JSON.stringify(json, null, 2);
    const result = capToolResultSize(text);

    // Payload is well under the cap, so compression would only add noise
    // (alias keys + a dictionary the LLM has to cross-reference) for no gain.
    expect(result).not.toContain('MAPPING_KEYS');
    expect(result).toContain('organization_id');
    // Result should be fully minified (no extra spaces outside of keys/values)
    expect(result).not.toContain('  ');
  });

  it('compresses keys with an alias dictionary once the payload is actually over the cap', () => {
    const json = Array.from({ length: 100 }, (_, i) => ({
      organization_id: i,
      department_name: 'IT'.repeat(20),
    }));
    const result = capToolResultSize(JSON.stringify(json));

    expect(result).toContain('MAPPING_KEYS');
    expect(result).toContain('organization_id');
  });

  it('scrubs PII (email, VN phone, JWT) out of tool results before they reach the LLM', () => {
    const json = {
      email: 'ceo@company.com',
      phone: '0987654321',
      token: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PYSk',
    };
    const result = capToolResultSize(JSON.stringify(json));

    expect(result).not.toContain('ceo@company.com');
    expect(result).not.toContain('0987654321');
    expect(result).not.toContain('eyJhbGciOiJIUzI1NiJ9');
    expect(result).toContain('[REDACTED]');
  });

  it('never exceeds the cap even when several individually-capped fields add up past it', () => {
    const json = {
      field1: 'x'.repeat(4000),
      field2: 'y'.repeat(4000),
      field3: 'z'.repeat(4000),
    };
    const result = capToolResultSize(JSON.stringify(json));

    expect(result.length).toBeLessThanOrEqual(6000);
    // Only the outer safety net's own marker should appear, no leftover
    // per-field ContextCapper markers nested inside it.
    expect((result.match(/\[truncated \d+ chars\]/g) ?? []).length).toBe(1);
  });
});
