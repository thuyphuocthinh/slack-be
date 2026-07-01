import { Processor } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import {
  BaseProcessor,
  EJobName,
  EQueueName,
  IProcessAiTriggerJobData,
} from '@slack/queue';

@Processor(EQueueName.AI_ORCHESTRATION_QUEUE, { concurrency: 5 })
export class AiOrchestrationProcessor extends BaseProcessor<
  IProcessAiTriggerJobData,
  void,
  EJobName
> {
  async process(
    job: Job<IProcessAiTriggerJobData, void, EJobName>,
  ): Promise<void> {
    switch (job.name) {
      case EJobName.PROCESS_AI_TRIGGER: {
        // TODO: Giai đoạn 1 — cắm orchestration engine thật vào đây
        // (ReAct loop, gọi agent_sql qua MCP, resolve credential qua mcp-auth...)
        this.logger.log(
          `AI orchestration triggered: ${JSON.stringify(job.data)}`,
        );
        break;
      }
      default:
        this.logger.warn(`Unknown job name: ${job.name}`);
        throw new Error(`Job name ${job.name} is not supported`);
    }
  }
}
