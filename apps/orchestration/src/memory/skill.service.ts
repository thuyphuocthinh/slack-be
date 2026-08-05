import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ECheckpointRiskLevel } from '@slack/constants';
import { SkillEntity, SkillStep } from '../entity/skill.entity';

export interface CreateSkillInput {
  workspaceId: string;
  taskDescription: string;
  summaryMarkdown: string;
  steps: SkillStep[];
  sourceCheckpointId: string;
  riskLevel: ECheckpointRiskLevel | null;
}

@Injectable()
export class SkillService {
  private readonly logger = new Logger(SkillService.name);

  constructor(
    @InjectRepository(SkillEntity)
    private readonly repo: Repository<SkillEntity>,
  ) {}

  async findByWorkspace(workspaceId: string): Promise<SkillEntity[]> {
    return this.repo.find({ where: { workspaceId } });
  }

  async create(input: CreateSkillInput): Promise<SkillEntity> {
    const skill = this.repo.create({
      workspaceId: input.workspaceId,
      taskDescription: input.taskDescription,
      summaryMarkdown: input.summaryMarkdown,
      steps: input.steps,
      sourceCheckpointIds: [input.sourceCheckpointId],
      riskLevel: input.riskLevel,
    });
    const saved = await this.repo.save(skill);
    this.logger.log(
      `create() workspaceId=${input.workspaceId} taskDescription="${input.taskDescription}"`,
    );
    return saved;
  }

  // Gộp thêm 1 lần chạy đúng nữa vào skill đã có — KHÔNG ghi đè steps cũ,
  // giữ nguyên chuỗi bước đã chứng minh đúng lần đầu.
  async incrementApprovedRunCount(
    skillId: string,
    sourceCheckpointId: string,
  ): Promise<void> {
    const skill = await this.repo.findOne({ where: { id: skillId } });
    if (!skill) return;

    await this.repo.update(skillId, {
      approvedRunCount: skill.approvedRunCount + 1,
      sourceCheckpointIds: [...skill.sourceCheckpointIds, sourceCheckpointId],
    });
  }
}
