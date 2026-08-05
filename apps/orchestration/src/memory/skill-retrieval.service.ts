import { Injectable, Logger } from '@nestjs/common';
import { traceable } from 'langsmith/traceable';
import { ECheckpointRiskLevel } from '@slack/constants';
import {
  OPENAI_EMBEDDING_MODEL,
  OpenAiEmbeddingProvider,
} from '../registry/openai-embedding.provider';
import { SkillService } from './skill.service';
import { SkillEntity } from '../entity/skill.entity';
import { cosineSimilarity } from './skill-cosine-similarity.util';
import { CHARS_PER_TOKEN_ESTIMATE } from '../executor/tool-result-size-cap.util';
import { attachEmbeddingCostMetadata } from '../llm/llm-cost.util';

// Bảo thủ có chủ đích — chưa có số liệu thật để tinh chỉnh, thà bỏ sót gợi ý
// còn hơn gợi ý sai skill.
const SIMILARITY_THRESHOLD = 0.85;

// Skill học từ hành động rủi ro cao cần nhiều lần chứng minh đúng hơn trước
// khi được gợi ý.
function minApprovedRunCount(riskLevel: ECheckpointRiskLevel | null): number {
  return riskLevel === ECheckpointRiskLevel.HIGH ? 4 : 2;
}

@Injectable()
export class SkillRetrievalService {
  private readonly logger = new Logger(SkillRetrievalService.name);

  constructor(
    private readonly skillService: SkillService,
    private readonly embeddingProvider: OpenAiEmbeddingProvider,
  ) {}

  // Dùng cho Supervisor.plan() — CHỈ gợi ý skill đã đủ tin cậy
  // (approvedRunCount qua ngưỡng theo riskLevel). Lỗi bất kỳ bước nào rơi về
  // null, không được chặn plan().
  async findMatching(
    taskDescription: string,
    workspaceId: string,
  ): Promise<SkillEntity | null> {
    const skills = await this.safeFindByWorkspace(workspaceId);
    const eligible = skills.filter(
      (s) => s.approvedRunCount >= minApprovedRunCount(s.riskLevel),
    );
    return this.findBestMatch(taskDescription, eligible);
  }

  // Dùng cho ApprovalFlowService sau khi 1 tool chạy thành công — so khớp với
  // MỌI skill đã có (kể cả chưa đủ tin cậy để gợi ý), để quyết định gộp thêm
  // 1 lần chạy đúng vào skill cũ hay đúc skill mới.
  async findSimilarForAcquisition(
    taskDescription: string,
    workspaceId: string,
  ): Promise<SkillEntity | null> {
    const skills = await this.safeFindByWorkspace(workspaceId);
    return this.findBestMatch(taskDescription, skills);
  }

  private async safeFindByWorkspace(
    workspaceId: string,
  ): Promise<SkillEntity[]> {
    try {
      return await this.skillService.findByWorkspace(workspaceId);
    } catch (error) {
      this.logger.warn(
        `findByWorkspace() failed for workspace ${workspaceId}: ${(error as Error).message}`,
      );
      return [];
    }
  }

  private async findBestMatch(
    taskDescription: string,
    candidates: SkillEntity[],
  ): Promise<SkillEntity | null> {
    if (candidates.length === 0) return null;

    try {
      const vectors = await this.embedAll(taskDescription, candidates);
      const [queryVector, ...candidateVectors] = vectors;

      let bestSkill: SkillEntity | null = null;
      let bestScore = -Infinity;
      for (let i = 0; i < candidates.length; i++) {
        const score = cosineSimilarity(queryVector, candidateVectors[i]);
        if (score >= SIMILARITY_THRESHOLD && score > bestScore) {
          bestSkill = candidates[i];
          bestScore = score;
        }
      }
      return bestSkill;
    } catch (error) {
      this.logger.warn(
        `findBestMatch() failed, skipping skill match: ${(error as Error).message}`,
      );
      return null;
    }
  }

  private embedAll(
    taskDescription: string,
    candidates: SkillEntity[],
  ): Promise<number[][]> {
    const estimatedChars =
      taskDescription.length +
      candidates.reduce((sum, s) => sum + s.taskDescription.length, 0);
    const estimatedTokens = Math.ceil(
      estimatedChars / CHARS_PER_TOKEN_ESTIMATE,
    );

    const embed = traceable(
      async () => {
        const vectors = await this.embeddingProvider.embed([
          taskDescription,
          ...candidates.map((s) => s.taskDescription),
        ]);
        attachEmbeddingCostMetadata(OPENAI_EMBEDDING_MODEL, estimatedTokens);
        return vectors;
      },
      { name: 'skill-retrieval.findBestMatch', run_type: 'llm' },
    );
    return embed();
  }
}
