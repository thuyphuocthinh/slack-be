import { Processor } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { BaseProcessor, EJobName, EQueueName, IUpdateDynamicProviderTokenJobData } from '@slack/queue';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DynamicProviderEntity } from '../entity/dynamic-provider.entity';

@Processor(EQueueName.DYNAMIC_PROVIDER_QUEUE, {
  concurrency: 2,
  lockDuration: 30000,
})
export class DynamicProviderProcessor extends BaseProcessor<IUpdateDynamicProviderTokenJobData, void, EJobName> {
  constructor(
    @InjectRepository(DynamicProviderEntity)
    private readonly providerRepo: Repository<DynamicProviderEntity>,
  ) {
    super();
  }

  async process(job: Job<IUpdateDynamicProviderTokenJobData, void, EJobName>): Promise<void> {
    if (job.name === EJobName.UPDATE_DYNAMIC_PROVIDER_TOKEN) {
      await this.handleUpdateDynamicProviderToken(job.data);
    } else {
      this.logger.warn(`Unknown job name: ${job.name}`);
    }
  }

  private async handleUpdateDynamicProviderToken(data: IUpdateDynamicProviderTokenJobData): Promise<void> {
    const { providerId, accessToken, refreshToken, tokenExpiresAt } = data;
    try {
      await this.providerRepo.update(providerId, {
        accessToken,
        refreshToken,
        tokenExpiresAt,
      });
      this.logger.log(`Successfully persisted token for provider ${providerId} via Queue.`);
    } catch (error) {
      this.logger.error(
        `Failed to persist token for provider ${providerId} via Queue: ${(error as Error).message}`,
        (error as Error).stack,
      );
      throw error; // Throw so BullMQ can retry
    }
  }
}
