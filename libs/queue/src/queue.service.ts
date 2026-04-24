import { Injectable, Logger } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { getQueueToken } from '@nestjs/bullmq';
import { Queue, JobsOptions } from 'bullmq';
import { EQueueName, EJobName } from './constants/queue.constant';
import { TJobData } from './interfaces/job-data.interface';

@Injectable()
export class QueueService {
  private readonly logger = new Logger(QueueService.name);

  constructor(private readonly moduleRef: ModuleRef) {}

  async addJob<T extends EJobName>(
    queueName: EQueueName,
    jobName: T,
    data: TJobData[T],
    options?: JobsOptions,
  ) {
    try {
      const queue = this.moduleRef.get<Queue>(getQueueToken(queueName), {
        strict: false,
      });

      if (!queue) {
        throw new Error(`Queue ${queueName} not found or not registered`);
      }

      const job = await queue.add(jobName, data, {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 1000,
        },
        removeOnComplete: true,
        removeOnFail: {
          age: 24 * 3600,
        },
        ...options,
      });

      this.logger.log(`Job ${job.id} added to queue ${queueName}`);
      return job;
    } catch (error) {
      this.logger.error(
        `Failed to add job to queue ${queueName}: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }
}
