import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { EQueueName, EJobName, TJobData } from '@slack/queue';
import { EdgeRelayRegistryService } from './edge-relay-registry.service';
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';

@Processor(EQueueName.EDGE_RELAY_QUEUE)
export class EdgeRelayProcessor extends WorkerHost {
  private readonly logger = new Logger(EdgeRelayProcessor.name);

  constructor(private readonly registry: EdgeRelayRegistryService) {
    super();
  }

  async process(
    job: Job<
      | TJobData[EJobName.EDGE_DISPATCH_MESSAGE]
      | TJobData[EJobName.EDGE_NOTIFY_MESSAGE]
    >,
  ): Promise<JSONRPCMessage | undefined> {
    const { workspaceId, message } = job.data;

    if (job.name === EJobName.EDGE_DISPATCH_MESSAGE) {
      try {
        return await this.registry.dispatch(workspaceId, message);
      } catch (error) {
        this.logger.error(
          `Failed to dispatch message to workspace ${workspaceId}: ${(error as Error).message}`,
        );
        throw error;
      }
    }

    if (job.name === EJobName.EDGE_NOTIFY_MESSAGE) {
      try {
        this.registry.notify(workspaceId, message);
      } catch (error) {
        this.logger.error(
          `Failed to notify workspace ${workspaceId}: ${(error as Error).message}`,
        );
        throw error;
      }
    }

    return undefined;
  }
}
