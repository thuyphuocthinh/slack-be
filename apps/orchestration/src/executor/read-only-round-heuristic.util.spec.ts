import { isLikelyReadOnlyRound } from './read-only-round-heuristic.util';

describe('isLikelyReadOnlyRound', () => {
  it('recognizes Vietnamese read-oriented verbs', () => {
    expect(isLikelyReadOnlyRound({ task: 'xem danh sách đơn hàng' })).toBe(
      true,
    );
    expect(
      isLikelyReadOnlyRound({ task: 'tra cứu thông tin khách hàng' }),
    ).toBe(true);
  });

  it('recognizes English read-oriented verbs', () => {
    expect(isLikelyReadOnlyRound({ task: 'get the user profile' })).toBe(true);
    expect(isLikelyReadOnlyRound({ task: 'list all open tickets' })).toBe(true);
  });

  it('returns false for a task with no read-oriented verb (likely a write action)', () => {
    expect(isLikelyReadOnlyRound({ task: 'tạo order mới cho khách A' })).toBe(
      false,
    );
    expect(isLikelyReadOnlyRound({ task: 'update the ticket status' })).toBe(
      false,
    );
  });

  it('matches whole words only, not substrings (bug-fix style guard)', () => {
    // "getaway" chứa "get" nhưng không phải từ "get" đứng riêng.
    expect(isLikelyReadOnlyRound({ task: 'book a getaway package' })).toBe(
      false,
    );
  });
});
