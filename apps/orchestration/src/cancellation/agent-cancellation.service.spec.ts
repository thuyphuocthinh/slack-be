import { AgentCancellationService } from './agent-cancellation.service';

describe('AgentCancellationService', () => {
  let redis: { set: jest.Mock; get: jest.Mock; exists: jest.Mock };
  let service: AgentCancellationService;

  beforeEach(() => {
    redis = { set: jest.fn(), get: jest.fn(), exists: jest.fn() };
    service = new AgentCancellationService(redis as any);
  });

  it('startTurn() writes the owner with a TTL', async () => {
    redis.set.mockResolvedValue('OK');

    await service.startTurn('msg-1', 'user-1');

    expect(redis.set).toHaveBeenCalledWith(
      expect.stringContaining('msg-1'),
      'user-1',
      'EX',
      expect.any(Number),
    );
  });

  it('startTurn() propagates a Redis failure instead of swallowing it', async () => {
    redis.set.mockRejectedValue(new Error('redis unreachable'));

    await expect(service.startTurn('msg-1', 'user-1')).rejects.toThrow(
      'redis unreachable',
    );
  });

  it('requestCancel() propagates a Redis failure instead of silently no-op-ing', async () => {
    redis.set.mockRejectedValue(new Error('redis unreachable'));

    await expect(service.requestCancel('msg-1')).rejects.toThrow(
      'redis unreachable',
    );
  });

  it('isCancelled() reflects the actual flag state', async () => {
    redis.exists.mockResolvedValue(1);
    await expect(service.isCancelled('msg-1')).resolves.toBe(true);

    redis.exists.mockResolvedValue(0);
    await expect(service.isCancelled('msg-1')).resolves.toBe(false);
  });

  it('getOwner() returns null when no turn is running', async () => {
    redis.get.mockResolvedValue(null);

    await expect(service.getOwner('msg-1')).resolves.toBeNull();
  });
});
