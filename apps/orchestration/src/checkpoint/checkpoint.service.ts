import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import { ORCHESTRATION_CONSTANTS } from '@slack/constants';
import {
  OrchestrationCheckpointEntity,
  OrchestrationCheckpointStatus,
} from '../entity/orchestration-checkpoint.entity';
import {
  ClaimCheckpointRequestDto,
  ClaimCheckpointResponseDto,
  CreateCheckpointRequestDto,
  FindPendingCheckpointRequestDto,
} from '../dto/checkpoint.dto';

@Injectable()
export class CheckpointService {
  private readonly logger = new Logger(CheckpointService.name);

  constructor(
    @InjectRepository(OrchestrationCheckpointEntity)
    private readonly repo: Repository<OrchestrationCheckpointEntity>,
  ) {}

  async create(
    dto: CreateCheckpointRequestDto,
  ): Promise<OrchestrationCheckpointEntity> {
    const expiresAt = new Date(
      Date.now() + ORCHESTRATION_CONSTANTS.CHECKPOINT_EXPIRY_MS,
    );
    this.logger.log(
      `create() replyMessageId=${dto.replyMessageId} tool=${dto.pendingTool.provider}.${dto.pendingTool.name} expiresAt=${expiresAt.toISOString()}`,
    );
    return this.repo.save(this.repo.create({ ...dto, expiresAt }));
  }

  async findPendingByReplyMessageId(
    dto: FindPendingCheckpointRequestDto,
  ): Promise<OrchestrationCheckpointEntity | null> {
    return this.repo.findOne({
      where: {
        replyMessageId: dto.replyMessageId,
        status: OrchestrationCheckpointStatus.PENDING,
      },
    });
  }

  // Step 8 — nguồn cho CheckpointCleanupService (@Cron), không nhận tham số vì
  // luôn so với "bây giờ".
  async findExpiredPending(): Promise<OrchestrationCheckpointEntity[]> {
    return this.repo.find({
      where: {
        status: OrchestrationCheckpointStatus.PENDING,
        expiresAt: LessThan(new Date()),
      },
    });
  }

  async claim(
    dto: ClaimCheckpointRequestDto,
  ): Promise<ClaimCheckpointResponseDto> {
    const result = await this.repo.update(
      { id: dto.id, status: OrchestrationCheckpointStatus.PENDING },
      { status: dto.toStatus },
    );
    const claimed = result.affected === 1;
    this.logger.log(
      `claim() id=${dto.id} toStatus=${dto.toStatus} claimed=${claimed}`,
    );
    return { claimed };
  }
}
