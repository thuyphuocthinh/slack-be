import { Injectable, Logger } from '@nestjs/common';
import { PendingToolCall } from '../entity/orchestration-checkpoint.entity';
import { CheckpointResponseDto } from '../dto/checkpoint.dto';
import { SkillService } from '../memory/skill.service';
import { SkillRetrievalService } from '../memory/skill-retrieval.service';

@Injectable()
export class ApprovalSkillRecorderService {
  private readonly logger = new Logger(ApprovalSkillRecorderService.name);

  constructor(
    private readonly skillService: SkillService,
    private readonly skillRetrieval: SkillRetrievalService,
  ) { }

  async record(input: {
    checkpointId: string;
    workspaceId: string;
    pendingTask: string;
    pendingTool: PendingToolCall;
    riskLevel: CheckpointResponseDto['riskLevel'];
  }): Promise<void> {
    try {
      const similar = await this.skillRetrieval.findSimilarForAcquisition(
        input.pendingTask,
        input.workspaceId,
      );
      if (similar) {
        await this.skillService.incrementApprovedRunCount(
          similar.id,
          input.checkpointId,
        );
        return;
      }
      await this.skillService.create({
        workspaceId: input.workspaceId,
        taskDescription: input.pendingTask,
        summaryMarkdown: `Gọi "${input.pendingTool.provider}.${input.pendingTool.name}" với tham số tương tự:\n${JSON.stringify(input.pendingTool.args, null, 2)}`,
        steps: [
          {
            provider: input.pendingTool.provider,
            tool: input.pendingTool.name,
            argsTemplate: input.pendingTool.args,
          },
        ],
        sourceCheckpointId: input.checkpointId,
        riskLevel: input.riskLevel,
      });
    } catch (error) {
      this.logger.warn(
        `record() failed for checkpoint ${input.checkpointId}: ${(error as Error).message}`,
      );
    }
  }
}
