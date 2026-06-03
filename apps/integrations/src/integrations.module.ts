import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EQueueName, QueueModule } from '@slack/queue';
import { IntegrationController } from './integration.controller';
import { IntegrationService } from './integration.service';
import { AiModule } from './ai/ai.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    QueueModule.forRoot(),
    QueueModule.forFeature([EQueueName.INCOMING_WEBHOOK_QUEUE]),
    AiModule,
  ],
  controllers: [IntegrationController],
  providers: [IntegrationService],
})
export class IntegrationsModule { }
