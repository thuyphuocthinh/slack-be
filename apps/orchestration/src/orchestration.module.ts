import { Module } from '@nestjs/common';
import { QueueModule, EQueueName } from '@slack/queue';
import { AiOrchestrationProcessor } from './processor/ai-orchestration.processor';

@Module({
  imports: [
    QueueModule.forRoot(),
    QueueModule.forFeature([EQueueName.AI_ORCHESTRATION_QUEUE]),
  ],
  providers: [AiOrchestrationProcessor],
})
export class OrchestrationModule {}
