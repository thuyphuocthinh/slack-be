import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ORCHESTRATION_CONSTANTS } from '@slack/constants';
import { ChannelMemoryService } from './channel-memory.service';

// channel_memory chỉ là gợi ý tham khảo, không phải nguồn sự thật lâu dài —
// tự xoá sau CHANNEL_MEMORY_TTL_HOURS, cùng pattern @Cron với CheckpointCleanupService.
@Injectable()
export class ChannelMemoryCleanupService {
  private readonly logger = new Logger(ChannelMemoryCleanupService.name);

  constructor(private readonly channelMemory: ChannelMemoryService) {}

  @Cron(CronExpression.EVERY_HOUR, { name: 'expire-channel-memory' })
  async expireOldMemories(): Promise<void> {
    const deleted = await this.channelMemory.deleteExpired(
      ORCHESTRATION_CONSTANTS.CHANNEL_MEMORY_TTL_HOURS,
    );
    if (deleted === 0) return;

    this.logger.log(`expireOldMemories() deleted ${deleted} expired row(s)`);
  }
}
