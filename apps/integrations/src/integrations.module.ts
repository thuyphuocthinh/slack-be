import { Module } from '@nestjs/common';
import { EQueueName, QueueModule } from '@slack/queue';
import { IntegrationController } from './integration.controller';
import { IntegrationService } from './integration.service';

@Module({
  imports: [
    QueueModule.forRoot(),
    QueueModule.forFeature([EQueueName.INCOMING_WEBHOOK_QUEUE]),
  ],
  controllers: [IntegrationController],
  providers: [IntegrationService],
})
export class IntegrationsModule { }
