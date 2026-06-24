import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger, Injectable } from '@nestjs/common';
import { EQueueName, EJobName, ISyncCalendarShiftJobData, IDeleteCalendarShiftJobData } from '@slack/queue';
import { SyncService } from './sync.service';

@Injectable()
@Processor(EQueueName.INTEGRATION_SYNC_QUEUE, {
  concurrency: 5, // Limit concurrent processing to avoid CPU spikes
  limiter: {
    max: 5, // Maximum 5 jobs per duration per worker
    duration: 1000, // 1 second - aligns with Google API limits
  },
})
export class SyncProcessor extends WorkerHost {
  private readonly logger = new Logger(SyncProcessor.name);

  constructor(private readonly syncService: SyncService) {
    super();
  }

  async process(job: Job): Promise<any> {
    this.logger.debug(`Processing job ${job.id} of type ${job.name}...`);

    switch (job.name) {
      case EJobName.SYNC_CALENDAR_SHIFT:
        await this.syncService.syncShiftToGoogleCalendar(job.data as ISyncCalendarShiftJobData);
        break;
        
      case EJobName.DELETE_CALENDAR_SHIFT:
        await this.syncService.deleteShiftFromGoogleCalendar(job.data as IDeleteCalendarShiftJobData);
        break;

      default:
        this.logger.warn(`Unknown job name: ${job.name}`);
    }
  }

  @OnWorkerEvent('completed')
  onCompleted(job: Job) {
    this.logger.log(`Completed job ${job.id} of type ${job.name}`);
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job, error: Error) {
    this.logger.error(`Failed job ${job.id} of type ${job.name}: ${error.message}`, error.stack);
  }
}
