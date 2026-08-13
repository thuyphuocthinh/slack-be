import { Injectable } from '@nestjs/common';
import {
  resolveDataCharBudget,
  resolveHistoryCharBudget,
  resolveMemoryCharBudget,
} from '../executor/tool-result-size-cap.util';
import { ChannelMemoryEntity } from '../entity/channel-memory.entity';
import { ChannelMemoryService } from './channel-memory.service';

export interface ContextBudget {
  toolResultCharBudget: number;
  memoryCharBudget: number;
  historyCharBudget: number;
}

// Single entry point for the 3 char budgets a model call splits its context
// window into, so callers can't end up combining a budget computed for one
// model with data meant for another.
@Injectable()
export class MemoryManagerService {
  constructor(private readonly channelMemory: ChannelMemoryService) {}

  buildBudget(modelId: string): ContextBudget {
    return {
      toolResultCharBudget: resolveDataCharBudget(modelId),
      memoryCharBudget: resolveMemoryCharBudget(modelId),
      historyCharBudget: resolveHistoryCharBudget(modelId),
    };
  }

  async getMemories(
    channelId: string,
    modelId: string,
    queryText?: string,
  ): Promise<ChannelMemoryEntity[]> {
    return this.channelMemory.getRecentMemories(
      channelId,
      resolveMemoryCharBudget(modelId),
      queryText,
    );
  }

  async recordUserDeclaredFact(
    channelId: string,
    sourceMessageId: string,
    fact: string,
  ): Promise<void> {
    return this.channelMemory.recordUserDeclaredFact(
      channelId,
      sourceMessageId,
      fact,
    );
  }
}
