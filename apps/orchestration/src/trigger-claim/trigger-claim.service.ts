import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OrchestrationTriggerClaimEntity } from '../entity/orchestration-trigger-claim.entity';

@Injectable()
export class TriggerClaimService {
  private readonly logger = new Logger(TriggerClaimService.name);

  constructor(
    @InjectRepository(OrchestrationTriggerClaimEntity)
    private readonly repo: Repository<OrchestrationTriggerClaimEntity>,
  ) {}

  // INSERT ... ON CONFLICT DO NOTHING — atomic "claim once", cùng tinh thần
  // CheckpointService.claim(). Chặn PROCESS_AI_TRIGGER chạy lại (BullMQ
  // retry/stalled) tạo thêm message "Đang xử lý..." trùng cho cùng 1
  // triggerMessageId.
  async claim(triggerMessageId: string): Promise<boolean> {
    const result = await this.repo
      .createQueryBuilder()
      .insert()
      .into(OrchestrationTriggerClaimEntity)
      .values({ triggerMessageId })
      .orIgnore()
      .execute();
    const claimed = result.identifiers.length === 1;
    this.logger.log(
      `claim() triggerMessageId=${triggerMessageId} claimed=${claimed}`,
    );
    return claimed;
  }
}
