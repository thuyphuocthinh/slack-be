import { Processor } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import {
  EQueueName,
  BaseProcessor,
  EJobName,
  IUpdateResourceMetadataJobData,
} from '@slack/queue';
import { ResourceService } from '../services/impl/resource.service';

@Processor(EQueueName.RESOURCE_QUEUE)
export class ResourceProcessor extends BaseProcessor<
  IUpdateResourceMetadataJobData,
  void,
  EJobName
> {
  constructor(private readonly resourceService: ResourceService) {
    super();
  }

  async process(
    job: Job<IUpdateResourceMetadataJobData, void, EJobName>,
  ): Promise<void> {
    const { resourceIds, refType, refId } = job.data;

    try {
      this.logger.log(
        `Updating metadata for resources: ${resourceIds.join(', ')} with refType: ${refType}, refId: ${refId}`,
      );
      
      await this.resourceService.updateMetadata(resourceIds, refType, refId);

      this.logger.log(`Successfully updated metadata for ${resourceIds.length} resources`);
    } catch (error) {
      this.logger.error(`Failed to update resource metadata: ${error.message}`);
      throw error;
    }
  }
}
