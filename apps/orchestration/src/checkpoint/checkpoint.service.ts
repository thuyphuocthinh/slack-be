import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { And, IsNull, LessThan, Not, Repository } from 'typeorm';
import { ORCHESTRATION_CONSTANTS } from '@slack/constants';
import {
  OrchestrationCheckpointEntity,
  OrchestrationCheckpointStatus,
} from '../entity/orchestration-checkpoint.entity';
import {
  CheckpointResponseDto,
  ClaimCheckpointExecutionRequestDto,
  ClaimCheckpointRequestDto,
  ClaimCheckpointResponseDto,
  CreateCheckpointRequestDto,
  FindCheckpointByIdRequestDto,
  FindPendingCheckpointRequestDto,
  MarkStalledAsRejectedRequestDto,
  MarkToolExecutedRequestDto,
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
    const toolLabel = dto.pendingTool
      ? `${dto.pendingTool.provider}.${dto.pendingTool.name}`
      : `clarification(${dto.clarificationCandidates?.map((c) => c.provider).join(',')})`;
    this.logger.log(
      `create() replyMessageId=${dto.replyMessageId} tool=${toolLabel} expiresAt=${expiresAt.toISOString()}`,
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

  // Bug fix — checkpoint kẹt vô hình sau worker crash:
  // status=APPROVED + execution_started_at IS NOT NULL (claimExecution() đã
  // chạy) nhưng worker crash trước khi tool thật sự chạy xong → không ai biết,
  // không bao giờ cleanup (findExpiredPending() chỉ quét PENDING).
  // Quét checkpoint quá STALLED_EXECUTION_TTL_MS kể từ execution_started_at —
  // đủ dài để không lẫn với execution đang thật sự chạy.
  async findStalledExecution(): Promise<CheckpointResponseDto[]> {
    const stalledBefore = new Date(
      Date.now() - ORCHESTRATION_CONSTANTS.STALLED_EXECUTION_TTL_MS,
    );
    const entities = await this.repo.find({
      where: {
        status: OrchestrationCheckpointStatus.APPROVED,
        executionStartedAt: And(Not(IsNull()), LessThan(stalledBefore)),
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
      remainingSteps,
      history,
      status,
      kind,
      clarificationQuestion,
      clarificationCandidates,
      selectedProvider,
      expiresAt,
      toolExecutedAt,
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
      remainingSteps,
      history,
      status,
      kind,
      clarificationQuestion,
      clarificationCandidates,
      selectedProvider,
      expiresAt,
      toolExecutedAt,
      createdAt,
      updatedAt,
    };
  }

  async claim(
    dto: ClaimCheckpointRequestDto,
  ): Promise<ClaimCheckpointResponseDto> {
    const result = await this.repo.update(
      { id: dto.id, status: OrchestrationCheckpointStatus.PENDING },
      {
        status: dto.toStatus,
        ...(dto.selectedProvider !== undefined && {
          selectedProvider: dto.selectedProvider,
        }),
      },
    );
    const claimed = result.affected === 1;
    this.logger.log(
      `claim() id=${dto.id} toStatus=${dto.toStatus} claimed=${claimed}`,
    );
    return { claimed };
  }

  // Giai đoạn 4, Step 1 — claim atomic RIÊNG cho lần thực thi (khác claim()
  // ở trên, vốn chuyển "status"). Dùng raw query để WHERE trực tiếp trên cột
  // vừa set (execution_started_at IS NULL) — TypeORM repo.update() không hỗ
  // trợ điều kiện "IS NULL" qua object criteria.
  async claimExecution(
    dto: ClaimCheckpointExecutionRequestDto,
  ): Promise<ClaimCheckpointResponseDto> {
    const result = await this.repo
      .createQueryBuilder()
      .update(OrchestrationCheckpointEntity)
      .set({ executionStartedAt: () => 'now()' })
      .where('id = :id', { id: dto.id })
      .andWhere('execution_started_at IS NULL')
      .execute();
    const claimed = result.affected === 1;
    this.logger.log(`claimExecution() id=${dto.id} claimed=${claimed}`);
    return { claimed };
  }

  // Bug fix — atomic update để dọn checkpoint kẹt sau worker crash. Khác
  // claim() (WHERE status=PENDING): ở đây checkpoint đã APPROVED nhưng
  // execution bị gián đoạn. WHERE status=APPROVED đảm bảo không nhầm với
  // checkpoint đang PENDING hoặc đã REJECTED (idempotent: nếu chạy 2 lần
  // thì lần 2 affected=0, claimed=false — an toàn).
  // Bug fix — set ngay sau khi mcpClient.callTool() thật đã chạy xong thành
  // công. Không cần atomic/conditional (chỉ ghi 1 lần, không tranh chấp).
  async markToolExecuted(dto: MarkToolExecutedRequestDto): Promise<void> {
    await this.repo
      .createQueryBuilder()
      .update(OrchestrationCheckpointEntity)
      .set({ toolExecutedAt: () => 'now()' })
      .where('id = :id', { id: dto.id })
      .execute();
  }

  // Đảo ngược claim() 'approved' khi bước enqueue job NGAY SAU nó lại thất bại — không
  // revert thì checkpoint kẹt vĩnh viễn ở APPROVED mà chưa job nào từng được tạo:
  // findExpiredPending() chỉ quét PENDING, findStalledExecution() cần execution_started_at
  // (chỉ set BÊN TRONG job không tồn tại đó). WHERE status='approved' đảm bảo chỉ tự sửa
  // đúng claim của chính request này.
  async revertApprovedClaim(dto: { id: string }): Promise<void> {
    await this.repo.update(
      { id: dto.id, status: OrchestrationCheckpointStatus.APPROVED },
      { status: OrchestrationCheckpointStatus.PENDING },
    );
  }

  async markStalledAsRejected(
    dto: MarkStalledAsRejectedRequestDto,
  ): Promise<ClaimCheckpointResponseDto> {
    const result = await this.repo.update(
      { id: dto.id, status: OrchestrationCheckpointStatus.APPROVED },
      { status: OrchestrationCheckpointStatus.REJECTED },
    );
    const claimed = result.affected === 1;
    this.logger.warn(`markStalledAsRejected() id=${dto.id} claimed=${claimed}`);
    return { claimed };
  }
}
