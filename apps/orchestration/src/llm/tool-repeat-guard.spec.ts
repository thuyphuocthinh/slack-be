import { ToolRepeatGuard } from './tool-repeat-guard';

describe('ToolRepeatGuard', () => {
  it('recordAttempt() counts up from 1 for each call with the same signature', () => {
    const guard = new ToolRepeatGuard();

    expect(guard.recordAttempt('sig-a')).toBe(1);
    expect(guard.recordAttempt('sig-a')).toBe(2);
    expect(guard.recordAttempt('sig-a')).toBe(3);
  });

  it('tracks each signature independently', () => {
    const guard = new ToolRepeatGuard();

    guard.recordAttempt('sig-a');
    guard.recordAttempt('sig-a');
    guard.recordAttempt('sig-b');

    expect(guard.recordAttempt('sig-a')).toBe(3);
    expect(guard.recordAttempt('sig-b')).toBe(2);
  });

  it('getCachedSuccess() returns undefined before anything is cached', () => {
    const guard = new ToolRepeatGuard();

    expect(guard.getCachedSuccess('sig-a')).toBeUndefined();
  });

  it('cacheSuccess()/getCachedSuccess() round-trip for the same signature', () => {
    const guard = new ToolRepeatGuard();

    guard.cacheSuccess('sig-a', 'preview text', 'feed text');

    expect(guard.getCachedSuccess('sig-a')).toEqual({
      resultPreview: 'preview text',
      feedText: 'feed text',
    });
  });

  it('does not leak a cached success across different signatures', () => {
    const guard = new ToolRepeatGuard();

    guard.cacheSuccess('sig-a', 'preview a', 'feed a');

    expect(guard.getCachedSuccess('sig-b')).toBeUndefined();
  });
});
