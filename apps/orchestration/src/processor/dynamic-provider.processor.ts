import { Processor } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import {
  BaseProcessor,
  EJobName,
  EQueueName,
  IUpdateDynamicProviderTokenJobData,
} from '@slack/queue';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DynamicProviderEntity } from '../entity/dynamic-provider.entity';

@Processor(EQueueName.DYNAMIC_PROVIDER_QUEUE, {
  concurrency: 2,
  lockDuration: 30000,
})
export class DynamicProviderProcessor extends BaseProcessor<
  IUpdateDynamicProviderTokenJobData,
  void,
  EJobName
> {
  constructor(
    @InjectRepository(DynamicProviderEntity)
    private readonly providerRepo: Repository<DynamicProviderEntity>,
  ) {
    super();
  }

  async process(
    job: Job<IUpdateDynamicProviderTokenJobData, void, EJobName>,
  ): Promise<void> {
    if (job.name === EJobName.UPDATE_DYNAMIC_PROVIDER_TOKEN) {
      await this.handleUpdateDynamicProviderToken(job.data);
    } else {
      this.logger.warn(`Unknown job name: ${job.name}`);
    }
  }

  private async handleUpdateDynamicProviderToken(
    data: IUpdateDynamicProviderTokenJobData,
  ): Promise<void> {
    const {
      providerId,
      accessToken,
      refreshToken,
      tokenExpiresAt,
      previousRefreshToken,
    } = data;
    try {
      // CAS: nếu 1 refresh khác đã ghi token mới hơn (VD job này bị retry sau khi
      // fail tạm thời, trong lúc đó refreshToken đã bị xoay vòng lần nữa), refreshToken
      // hiện tại trong DB sẽ KHÔNG còn khớp previousRefreshToken nữa — bỏ qua write này
      // thay vì đè lên token mới hơn bằng token cũ đã bị provider vô hiệu hoá.
      const where = previousRefreshToken
        ? { id: providerId, refreshToken: previousRefreshToken }
        : providerId;
      const result = await this.providerRepo.update(where, {
        accessToken,
        refreshToken,
        tokenExpiresAt,
      });
      if (previousRefreshToken && result.affected === 0) {
        this.logger.warn(
          `Skipped stale token write for provider ${providerId} — refreshToken already rotated by a newer update.`,
        );
        return;
      }
      this.logger.log(
        `Successfully persisted token for provider ${providerId} via Queue.`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to persist token for provider ${providerId} via Queue: ${(error as Error).message}`,
        (error as Error).stack,
      );
      throw error; // Throw so BullMQ can retry
    }
  }
}
