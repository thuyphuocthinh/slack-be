import { Injectable, Logger } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { getQueueToken } from '@nestjs/bullmq';
import { Queue, JobsOptions } from 'bullmq';
import { EQueueName } from './constants/queue.constant';
import { TJobData } from './interfaces/job-data.interface';

@Injectable()
export class QueueService {
  private readonly logger = new Logger(QueueService.name);

  constructor(private readonly moduleRef: ModuleRef) {}

  async addJob<T extends keyof TJobData>(
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

  async addBulkJobs<T extends keyof TJobData>(
    queueName: EQueueName,
    jobs: { name: T; data: TJobData[T]; opts?: JobsOptions }[],
  ) {
    try {
      const queue = this.moduleRef.get<Queue>(getQueueToken(queueName), {
        strict: false,
      });

      if (!queue) {
        throw new Error(`Queue ${queueName} not found or not registered`);
      }

      const defaultOpts = {
        attempts: 3,
        backoff: { type: 'exponential', delay: 1000 },
        removeOnComplete: true,
        removeOnFail: { age: 24 * 3600 },
      };

      const jobsWithOpts = jobs.map((job) => ({
        ...job,
        opts: { ...defaultOpts, ...job.opts },
      }));

      await queue.addBulk(jobsWithOpts);
      this.logger.log(`Added ${jobs.length} bulk jobs to queue ${queueName}`);
    } catch (error) {
      this.logger.error(
        `Failed to add bulk jobs to queue ${queueName}: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  // Backpressure/Admission control — chỉ đếm 'waiting'+'active' (đủ để biết
  // hàng đợi có đang phình lên do worker xử lý không kịp hay không), bỏ qua
  // completed/failed/delayed vì không phản ánh tải THỰC hiện tại.
  async getJobCounts(queueName: EQueueName): Promise<Record<string, number>> {
    const queue = this.moduleRef.get<Queue>(getQueueToken(queueName), {
      strict: false,
    });

    if (!queue) {
      throw new Error(`Queue ${queueName} not found or not registered`);
    }

    return queue.getJobCounts('waiting', 'active');
  }

  async isOverloaded(
    queueName: EQueueName,
    maxDepth: number,
  ): Promise<boolean> {
    const counts = await this.getJobCounts(queueName);
    return (counts.waiting ?? 0) + (counts.active ?? 0) > maxDepth;
  }

  async removeJob(queueName: EQueueName, jobId: string) {
    try {
      const queue = this.moduleRef.get<Queue>(getQueueToken(queueName), {
        strict: false,
      });

      if (!queue) {
        throw new Error(`Queue ${queueName} not found or not registered`);
      }

      const job = await queue.getJob(jobId);
      if (job) {
        await job.remove();
        this.logger.log(`Job ${jobId} removed from queue ${queueName}`);
      }
    } catch (error) {
      this.logger.error(
        `Failed to remove job from queue ${queueName}: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }
}
