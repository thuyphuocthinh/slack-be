import { Test, TestingModule } from '@nestjs/testing';
import { AiTriggerPriorityService } from './aiTriggerPriority.service';
import { RateLimitService } from './rateLimit.service';
import { CACHE } from './cached.constant';

describe('AiTriggerPriorityService', () => {
  let service: AiTriggerPriorityService;
  let rateLimit: { incrementInWindow: jest.Mock };

  beforeEach(async () => {
    rateLimit = { incrementInWindow: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AiTriggerPriorityService,
        { provide: RateLimitService, useValue: rateLimit },
      ],
    }).compile();

    service = module.get<AiTriggerPriorityService>(AiTriggerPriorityService);
  });

  it('returns the raw count from RateLimitService', async () => {
    rateLimit.incrementInWindow.mockResolvedValue(3);

    await expect(service.countRecentTriggers('ws-1', 60)).resolves.toBe(3);
  });

  it('counts each workspace under its own key and passes through the window', async () => {
    rateLimit.incrementInWindow.mockResolvedValue(1);

    await service.countRecentTriggers('ws-1', 60);

    expect(rateLimit.incrementInWindow).toHaveBeenCalledWith(
      CACHE.ORCHESTRATION.KEYS.WORKSPACE_TRIGGER_COUNT('ws-1'),
      60,
    );
  });

  it('gives independent counts to different workspaces', async () => {
    rateLimit.incrementInWindow.mockResolvedValue(1);

    await service.countRecentTriggers('ws-1', 60);
    await service.countRecentTriggers('ws-2', 60);

    const keysUsed = rateLimit.incrementInWindow.mock.calls.map(
      (call) => call[0],
    );
    expect(new Set(keysUsed).size).toBe(2);
  });
});
