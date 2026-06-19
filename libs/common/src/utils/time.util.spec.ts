import { isUtcString } from './time.util';

describe('isUtcString', () => {
  it('should return true for valid strictly UTC ISO strings ending with Z', () => {
    expect(isUtcString('2026-06-20T02:00:00Z')).toBe(true);
    expect(isUtcString('2026-06-20T02:00:00.000Z')).toBe(true);
    expect(isUtcString('2024-02-29T12:30:45.123Z')).toBe(true); // Leap year valid
  });

  it('should return false for valid ISO strings that do not end with Z (local or offset)', () => {
    expect(isUtcString('2026-06-20T02:00:00')).toBe(false); // No timezone
    expect(isUtcString('2026-06-20T02:00:00+00:00')).toBe(false); // Technically UTC but doesn't end with Z
    expect(isUtcString('2026-06-20T09:00:00+07:00')).toBe(false); // With offset
  });

  it('should return false for strings ending with Z but not valid dates', () => {
    expect(isUtcString('InvalidDateStringZ')).toBe(false);
    expect(isUtcString('Z')).toBe(false);
    expect(isUtcString('2026-13-40T02:00:00Z')).toBe(false); // Invalid month/day
  });

  it('should return false for non-string inputs', () => {
    expect(isUtcString(null as any)).toBe(false);
    expect(isUtcString(undefined as any)).toBe(false);
    expect(isUtcString(123 as any)).toBe(false);
    expect(isUtcString({} as any)).toBe(false);
    expect(isUtcString([] as any)).toBe(false);
  });

  it('should return false for empty strings', () => {
    expect(isUtcString('')).toBe(false);
    expect(isUtcString('   ')).toBe(false);
  });
});
