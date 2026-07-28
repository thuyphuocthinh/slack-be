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

  // Chỉ gọi khi claim() vừa xong nhưng chưa có gì THẬT được tạo ra (VD
  // createMessage()/startTurn() lỗi TRƯỚC KHI có reply message) — retry sau đó
  // hoàn toàn an toàn (không tạo trùng gì cả), nên xoá claim để lần retry kế
  // tiếp của BullMQ không bị chặn oan, tránh turn bị mất tích im lặng vĩnh viễn.
  // KHÔNG được gọi sau khi reply message đã tồn tại — lúc đó retry có thể tạo
  // thêm 1 message "Đang xử lý..." trùng, đúng thứ claim() được sinh ra để chặn.
  async release(triggerMessageId: string): Promise<void> {
    await this.repo.delete({ triggerMessageId });
    this.logger.warn(
      `release() triggerMessageId=${triggerMessageId} — xoá claim để lần retry kế tiếp không bị chặn oan (chưa có gì thật được tạo)`,
    );
  }
}
