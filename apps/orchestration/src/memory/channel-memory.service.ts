import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import { traceable } from 'langsmith/traceable';
import { buildTTL } from '@slack/common';
import { ORCHESTRATION_CONSTANTS } from '@slack/constants';
import { SemanticToolIndex } from '../common/agentic-openapi-parser';
import {
  OPENAI_EMBEDDING_MODEL,
  OpenAiEmbeddingProvider,
} from '../registry/openai-embedding.provider';
import { ChannelMemoryEntity } from '../entity/channel-memory.entity';
import { ToolCallTraceDto } from '../dto/react-loop.dto';
import { isLikelyCreateToolCall } from './create-tool-heuristic.util';
import { looksLikeInjection } from './memory-injection-heuristic.util';
import { CHARS_PER_TOKEN_ESTIMATE } from '../executor/tool-result-size-cap.util';
import { attachEmbeddingCostMetadata } from '../llm/llm-cost.util';

// SemanticToolIndex chỉ cần {name, description} — dùng row.id làm khoá join
// ngược lại entity gốc sau khi search() trả về, row.content làm text để embed.
interface IndexableMemory {
  name: string;
  description: string;
}

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
    private readonly embeddingProvider: OpenAiEmbeddingProvider,
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

  // Giai đoạn 2 (Agent OS) — dọn fact đã quá TTL, gọi định kỳ từ
  // ChannelMemoryCleanupService. TTL cố định cho mọi row nên chỉ cần so
  // createdAt với ngưỡng thời gian, không cần cột expiresAt riêng.
  async deleteExpired(ttlHours: number): Promise<number> {
    const cutoff = new Date(Date.now() - buildTTL('HOUR', ttlHours));
    const result = await this.repo.delete({ createdAt: LessThan(cutoff) });
    return result.affected ?? 0;
  }

  // queryText (thường là prompt hiện tại) xếp hạng theo ngữ nghĩa thay vì chỉ
  // recency — bỏ qua hoặc embedding lỗi thì rơi về đúng thứ tự cũ.
  async getRecentMemories(
    channelId: string,
    charBudget: number = ORCHESTRATION_CONSTANTS.CHANNEL_MEMORY_READ_LIMIT *
      ORCHESTRATION_CONSTANTS.CHANNEL_MEMORY_CONTENT_MAX_CHARS,
    queryText?: string,
  ): Promise<ChannelMemoryEntity[]> {
    try {
      const rows = await this.repo.find({
        where: { channelId },
        order: { createdAt: 'DESC' },
        take: ORCHESTRATION_CONSTANTS.CHANNEL_MEMORY_READ_LIMIT,
      });
      const ranked = queryText
        ? await this.rankBySimilarity(rows, queryText)
        : rows;
      return this.capToCharBudget(ranked, charBudget);
    } catch (error) {
      this.logger.warn(
        `getRecentMemories() failed for channel ${channelId}: ${(error as Error).message}`,
      );
      return [];
    }
  }

  private async rankBySimilarity(
    rows: ChannelMemoryEntity[],
    queryText: string,
  ): Promise<ChannelMemoryEntity[]> {
    if (rows.length === 0) return rows;

    // Ước lượng token thô từ tổng ký tự (rows + query) TRƯỚC khi gọi embedding
    // — không đọc usage thật từ response vì OpenAiEmbeddingProvider là 1
    // singleton dùng chung cho nhiều request đồng thời, lưu usage tạm trên
    // instance sẽ dễ lẫn số giữa các lượt gọi song song.
    const estimatedChars =
      rows.reduce((sum, row) => sum + (row.content?.length ?? 0), 0) +
      queryText.length;
    const estimatedTokens = Math.ceil(
      estimatedChars / CHARS_PER_TOKEN_ESTIMATE,
    );

    const rank = traceable(
      async () => {
        const index = new SemanticToolIndex<IndexableMemory>(
          this.embeddingProvider,
        );
        await index.build(
          rows.map((row) => ({ name: row.id, description: row.content })),
        );
        const searched = await index.search(queryText, rows.length);
        attachEmbeddingCostMetadata(OPENAI_EMBEDDING_MODEL, estimatedTokens);
        return searched;
      },
      { name: 'channel-memory.rankBySimilarity', run_type: 'llm' },
    );

    try {
      const ranked = await rank();
      const byId = new Map(rows.map((row) => [row.id, row]));
      const result = ranked
        .map((item) => byId.get(item.name))
        .filter((row): row is ChannelMemoryEntity => !!row);
      return result.length > 0 ? result : rows;
    } catch (error) {
      this.logger.warn(
        `rankBySimilarity() failed, falling back to recency order: ${(error as Error).message}`,
      );
      return rows;
    }
  }

  // Luôn giữ ít nhất dòng MỚI NHẤT (đầu mảng, đã ORDER BY createdAt DESC) dù
  // riêng nó đã vượt budget — tránh trả về rỗng chỉ vì 1 model có context
  // window quá nhỏ, giống tinh thần safety net ở capToolResultSize().
  private capToCharBudget(
    rows: ChannelMemoryEntity[],
    charBudget: number,
  ): ChannelMemoryEntity[] {
    const kept: ChannelMemoryEntity[] = [];
    let used = 0;
    for (const row of rows) {
      const next = used + (row.content?.length ?? 0);
      if (next > charBudget && kept.length > 0) break;
      kept.push(row);
      used = next;
    }
    return kept;
  }
}
