import { Processor } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Injectable } from '@nestjs/common';
import { 
  EQueueName, 
  EJobName, 
  ISyncCalendarShiftJobData, 
  IDeleteCalendarShiftJobData,
  BaseProcessor 
} from '@slack/queue';
import { SyncService } from './sync.service';

export interface ISyncProcessResult {
  success: boolean;
  reason?: string;
}

export type TSyncJobData = ISyncCalendarShiftJobData | IDeleteCalendarShiftJobData;


@Processor(EQueueName.INTEGRATION_SYNC_QUEUE, {
  concurrency: 5, // Xử lý đồng thời 5 jobs
  limiter: {
    max: 10, // Tối đa 10 jobs
    duration: 1000, // trên mỗi 1000ms (1 giây)
  },
})
export class SyncProcessor extends BaseProcessor<TSyncJobData, ISyncProcessResult, EJobName> {
  constructor(private readonly syncService: SyncService) {
    super();
  }

  async process(job: Job<TSyncJobData, ISyncProcessResult, EJobName>): Promise<ISyncProcessResult> {
    switch (job.name) {
      case EJobName.SYNC_CALENDAR_SHIFT:
        await this.syncService.syncShiftToGoogleCalendar(job.data as ISyncCalendarShiftJobData);
        return { success: true };
        
      case EJobName.DELETE_CALENDAR_SHIFT:
        await this.syncService.deleteShiftFromGoogleCalendar(job.data as IDeleteCalendarShiftJobData);
        return { success: true };

      default:
        this.logger.warn(`Unknown job name: ${job.name}`);
        return { success: false, reason: 'Unknown job name' };
    }
  }
}
