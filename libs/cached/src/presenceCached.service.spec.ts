import { PresenceCacheService } from './presenceCached.service';
import { CACHE } from './cached.constant';

describe('PresenceCacheService multi-connection tracking', () => {
  const redis = {
    eval: jest.fn(),
    del: jest.fn(),
    mget: jest.fn(),
  };
  const service = new PresenceCacheService(redis as never);

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Date, 'now').mockReturnValue(1_780_000_000_000);
  });

  afterEach(() => jest.restoreAllMocks());

  it('registers each socket independently under the user connection set', async () => {
    redis.eval.mockResolvedValue(1);

    await service.registerConnection('user-1', 'socket-a');
    await service.registerConnection('user-1', 'socket-b');

    expect(redis.eval).toHaveBeenCalledTimes(2);
    expect(redis.eval.mock.calls[0]).toEqual(
      expect.arrayContaining([
        2,
        CACHE.PRESENCE.KEYS.USER_STATUS('user-1'),
        CACHE.PRESENCE.KEYS.USER_CONNECTIONS('user-1'),
        1_780_000_000,
        1_780_000_000 + CACHE.PRESENCE.SETTINGS.ONLINE_THRESHOLD,
        'socket-a',
      ]),
    );
    expect(redis.eval.mock.calls[1]).toEqual(
      expect.arrayContaining(['socket-b']),
    );
  });

  it('removes only the disconnected socket and returns the remaining count', async () => {
    redis.eval.mockResolvedValue(1);

    await expect(service.removeConnection('user-1', 'socket-a')).resolves.toBe(
      1,
    );
    expect(redis.eval.mock.calls[0]).toEqual(
      expect.arrayContaining([
        CACHE.PRESENCE.KEYS.USER_CONNECTIONS('user-1'),
        'socket-a',
      ]),
    );
  });

  it('clears status and all connection state on an explicit logout', async () => {
    await service.removeStatus('user-1');

    expect(redis.del).toHaveBeenCalledWith(
      CACHE.PRESENCE.KEYS.USER_STATUS('user-1'),
      CACHE.PRESENCE.KEYS.USER_CONNECTIONS('user-1'),
    );
  });
});
