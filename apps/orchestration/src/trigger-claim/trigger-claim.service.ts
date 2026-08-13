import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import { OrchestrationTriggerClaimEntity } from '../entity/orchestration-trigger-claim.entity';

// BullMQ retry window cho PROCESS_AI_TRIGGER (lockDuration 60s + attempts:3 backoff ngắn)
// luôn xong trong vài phút — quá mốc này mà claim vẫn còn nghĩa là turn đã chết (worker
// crash cứng giữa chừng), không còn gì đang xử lý thật để tôn trọng nữa.
const CLAIM_TTL_MS = 10 * 60 * 1000;

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

  // Reaper — không có cách nào release() một claim mà worker giữ nó đã crash cứng
  // (SIGKILL/OOM giữa claim() và createMessage(), không catch nào chạy được). Nếu
  // không dọn, claim đó khoá messageId này vĩnh viễn, turn mất tích không dấu vết.
  // TTL dài hơn NHIỀU so với toàn bộ retry window thật (xem CLAIM_TTL_MS) nên không
  // bao giờ xoá nhầm 1 claim đang được xử lý hợp lệ.
  @Cron(CronExpression.EVERY_10_MINUTES, { name: 'reap-stale-trigger-claims' })
  async reapStaleClaims(): Promise<void> {
    const result = await this.repo.delete({
      createdAt: LessThan(new Date(Date.now() - CLAIM_TTL_MS)),
    });
    if (result.affected) {
      this.logger.warn(
        `reapStaleClaims() removed ${result.affected} stale claim(s) older than ${CLAIM_TTL_MS}ms`,
      );
    }
  }
}
