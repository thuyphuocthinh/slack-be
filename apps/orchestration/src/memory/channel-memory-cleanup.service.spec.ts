import { Test, TestingModule } from '@nestjs/testing';
import { ORCHESTRATION_CONSTANTS } from '@slack/constants';
import { ChannelMemoryCleanupService } from './channel-memory-cleanup.service';
import { ChannelMemoryService } from './channel-memory.service';

describe('ChannelMemoryCleanupService', () => {
  let service: ChannelMemoryCleanupService;
  const mockChannelMemory = { deleteExpired: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChannelMemoryCleanupService,
        { provide: ChannelMemoryService, useValue: mockChannelMemory },
      ],
    }).compile();

    service = module.get<ChannelMemoryCleanupService>(
      ChannelMemoryCleanupService,
    );
  });

  it('deletes expired memories using the configured TTL', async () => {
    mockChannelMemory.deleteExpired.mockResolvedValue(0);

    await service.expireOldMemories();

    expect(mockChannelMemory.deleteExpired).toHaveBeenCalledWith(
      ORCHESTRATION_CONSTANTS.CHANNEL_MEMORY_TTL_HOURS,
    );
  });

  it('does not throw when nothing was expired', async () => {
    mockChannelMemory.deleteExpired.mockResolvedValue(0);

    await expect(service.expireOldMemories()).resolves.toBeUndefined();
  });

  it('completes normally after deleting expired rows', async () => {
    mockChannelMemory.deleteExpired.mockResolvedValue(5);

    await expect(service.expireOldMemories()).resolves.toBeUndefined();
    expect(mockChannelMemory.deleteExpired).toHaveBeenCalledTimes(1);
  });
});
