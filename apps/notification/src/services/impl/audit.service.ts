import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditLog } from '../../entity/audit.entity';
import { CreateAuditLogDto, FetchAuditLogsDto } from '../../dto/audit.dto';
import { IOffsetResponse } from '@slack/common';

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    @InjectRepository(AuditLog)
    private readonly auditRepo: Repository<AuditLog>,
  ) {}

  async createAuditLog(dto: CreateAuditLogDto): Promise<AuditLog> {
    try {
      const auditLog = this.auditRepo.create({
        action: dto.action,
        actorId: dto.actorId,
        targetId: dto.targetId,
        entityType: dto.entityType,
        entityId: dto.entityId,
        metadata: dto.metadata,
      });

      const saved = await this.auditRepo.save(auditLog);

      // TODO: Implement realtime notification/broadcast for audit logs if needed
      // Currently, we only persist the audit log.
      // this.broadcastAuditLog(saved);

      return saved;
    } catch (error) {
      this.logger.error(`Failed to create audit log: ${error.message}`);
      throw error;
    }
  }

  async fetchAuditLogs(
    dto: FetchAuditLogsDto,
  ): Promise<IOffsetResponse<AuditLog[]>> {
    const {
      actorId,
      targetId,
      entityType,
      entityId,
      action,
      page = 1,
      limit = 20,
    } = dto;
    const skip = (page - 1) * limit;

    const query = this.auditRepo.createQueryBuilder('audit');

    if (actorId) {
      query.andWhere('audit.actorId = :actorId', { actorId });
    }

    if (targetId) {
      query.andWhere('audit.targetId = :targetId', { targetId });
    }

    if (entityType) {
      query.andWhere('audit.entityType = :entityType', { entityType });
    }

    if (entityId) {
      query.andWhere('audit.entityId = :entityId', { entityId });
    }

    if (action) {
      query.andWhere('audit.action = :action', { action });
    }

    query.orderBy('audit.createdAt', 'DESC');
    query.skip(skip).take(limit);

    const [items, total] = await query.getManyAndCount();

    return {
      data: items,
      paging: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    } as unknown as IOffsetResponse<AuditLog[]>;
  }

  /**
   * NOTE: Realtime broadcast for audit logs will be implemented later.
   * This could involve emitting events via Socket.io or a message broker
   * to notify admins or relevant users about certain actions in realtime.
   */
  // private async broadcastAuditLog(log: AuditLog) {
  //   // Implementation for realtime broadcast goes here
  // }
}
