import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ORCHESTRATION_CONSTANTS } from '@slack/constants';
import { ChannelMemoryEntity } from '../entity/channel-memory.entity';
import { ToolCallTraceDto } from '../dto/react-loop.dto';
import { isLikelyCreateToolCall } from './create-tool-heuristic.util';
import { looksLikeInjection } from './memory-injection-heuristic.util';

// ver3.md mục 1 (dài hạn) — ghi nhớ THỰC THỂ ổn định vừa được tạo thành công
// trong 1 channel, đọc lại làm gợi ý ngữ cảnh cho SupervisorService.plan().
// Ghi nhớ là concern PHỤ — lỗi ở đây tuyệt đối không được chặn luồng chính
// (giống triết lý tryUpdateMessage()/buildTruncatedHistorySummary()).
@Injectable()
export class ChannelMemoryService {
  private readonly logger = new Logger(ChannelMemoryService.name);

  constructor(
    @InjectRepository(ChannelMemoryEntity)
    private readonly repo: Repository<ChannelMemoryEntity>,
  ) {}

  async recordSuccessfulCreateCalls(
    channelId: string,
    sourceMessageId: string,
    toolCalls: ToolCallTraceDto[],
  ): Promise<void> {
    const maxChars = ORCHESTRATION_CONSTANTS.CHANNEL_MEMORY_CONTENT_MAX_CHARS;
    const rows = toolCalls
      .filter(
        (tc) =>
          tc.status === 'success' &&
          !!tc.resultPreview &&
          isLikelyCreateToolCall(tc),
      )
      .map((tc) => {
        const joined = `${tc.tool}: ${tc.resultPreview}`;
        return {
          channelId,
          sourceMessageId,
          tool: tc.tool,
          content:
            joined.length > maxChars
              ? `${joined.slice(0, maxChars)}...`
              : joined,
        };
      })
      .filter((row) => {
        if (!looksLikeInjection(row.content)) return true;
        this.logger.warn(
          `recordSuccessfulCreateCalls() skipped a suspicious memory for channel ${channelId} (looks like a prompt injection attempt)`,
        );
        return false;
      });

    if (rows.length === 0) return;

    try {
      await this.repo
        .createQueryBuilder()
        .insert()
        .into(ChannelMemoryEntity)
        .values(rows)
        .orIgnore()
        .execute();
    } catch (error) {
      this.logger.warn(
        `recordSuccessfulCreateCalls() failed for channel ${channelId}: ${(error as Error).message}`,
      );
    }
  }

  async getRecentMemories(channelId: string): Promise<ChannelMemoryEntity[]> {
    try {
      return await this.repo.find({
        where: { channelId },
        order: { createdAt: 'DESC' },
        take: ORCHESTRATION_CONSTANTS.CHANNEL_MEMORY_READ_LIMIT,
      });
    } catch (error) {
      this.logger.warn(
        `getRecentMemories() failed for channel ${channelId}: ${(error as Error).message}`,
      );
      return [];
    }
  }
}
