import { Processor } from '@nestjs/bullmq';
import {
  BaseProcessor,
  EQueueName,
  EJobName,
  IAuditJobData,
} from '@slack/queue';
import { Job } from 'bullmq';
import { AuditService } from '../services/impl/audit.service';
import { AuditAction, AuditEntityType } from '../types/audit.type';

@Processor(EQueueName.AUDIT_QUEUE)
export class AuditProcessor extends BaseProcessor<IAuditJobData, void, EJobName> {
  constructor(private readonly auditService: AuditService) {
    super();
  }

  async process(job: Job<IAuditJobData, void, EJobName>): Promise<void> {
    switch (job.name) {
      case EJobName.SAVE_AUDIT_LOG: {
        const data = job.data;
        this.logger.log(`Handling audit log for action: ${data.action}`);

        await this.auditService.createAuditLog({
          action: data.action as AuditAction,
          actorId: data.actorId,
          targetId: data.targetId,
          entityType: data.entityType as AuditEntityType,
          entityId: data.entityId,
          metadata: data.metadata,
        });
        return;
      }

      default:
        this.logger.warn(`Unknown job name: ${job.name}`);
        throw new Error(`Job name ${job.name} is not supported`);
    }
  }
}
