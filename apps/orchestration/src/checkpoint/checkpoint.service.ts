import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import { ORCHESTRATION_CONSTANTS } from '@slack/constants';
import {
  OrchestrationCheckpointEntity,
  OrchestrationCheckpointStatus,
} from '../entity/orchestration-checkpoint.entity';
import {
  CheckpointResponseDto,
  ClaimCheckpointRequestDto,
  ClaimCheckpointResponseDto,
  CreateCheckpointRequestDto,
  FindCheckpointByIdRequestDto,
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
  ): Promise<CheckpointResponseDto> {
    const expiresAt = new Date(
      Date.now() + ORCHESTRATION_CONSTANTS.CHECKPOINT_EXPIRY_MS,
    );
    this.logger.log(
      `create() replyMessageId=${dto.replyMessageId} tool=${dto.pendingTool.provider}.${dto.pendingTool.name} expiresAt=${expiresAt.toISOString()}`,
    );
    const saved = await this.repo.save(this.repo.create({ ...dto, expiresAt }));
    return this.toResponseDto(saved);
  }

  async findPendingByReplyMessageId(
    dto: FindPendingCheckpointRequestDto,
  ): Promise<CheckpointResponseDto | null> {
    const entity = await this.repo.findOne({
      where: {
        replyMessageId: dto.replyMessageId,
        status: OrchestrationCheckpointStatus.PENDING,
      },
    });
    return entity ? this.toResponseDto(entity) : null;
  }

  // Step 8 — nguồn cho CheckpointCleanupService (@Cron), không nhận tham số vì
  // luôn so với "bây giờ".
  async findExpiredPending(): Promise<CheckpointResponseDto[]> {
    const entities = await this.repo.find({
      where: {
        status: OrchestrationCheckpointStatus.PENDING,
        expiresAt: LessThan(new Date()),
      },
    });
    return entities.map((e) => this.toResponseDto(e));
  }

  async findById(
    dto: FindCheckpointByIdRequestDto,
  ): Promise<CheckpointResponseDto | null> {
    const entity = await this.repo.findOne({ where: { id: dto.id } });
    return entity ? this.toResponseDto(entity) : null;
  }

  // Chốt chặn giữa ORM entity và phần còn lại của app — field mới thêm vào
  // entity sẽ KHÔNG tự lộ ra ngoài trừ khi cũng được thêm vào đây.
  private toResponseDto(
    entity: OrchestrationCheckpointEntity,
  ): CheckpointResponseDto {
    const {
      id,
      replyMessageId,
      userId,
      botUserId,
      channelId,
      workspaceId,
      channelType,
      originalPrompt,
      pendingTool,
      pendingTask,
      roundsSoFar,
      history,
      status,
      expiresAt,
      createdAt,
      updatedAt,
    } = entity;
    return {
      id,
      replyMessageId,
      userId,
      botUserId,
      channelId,
      workspaceId,
      channelType,
      originalPrompt,
      pendingTool,
      pendingTask,
      roundsSoFar,
      history,
      status,
      expiresAt,
      createdAt,
      updatedAt,
    };
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
