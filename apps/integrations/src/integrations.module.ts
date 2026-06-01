import { Module } from '@nestjs/common';
import { IntegrationsController } from './integrations.controller';
import { IntegrationsService } from './integrations.service';
import { WebhooksModule } from './webhooks/webhooks.module';
import { QueueModule } from '@slack/queue';

@Module({
  imports: [
    QueueModule.forRoot(),
    WebhooksModule,
  ],
  controllers: [IntegrationsController],
  providers: [IntegrationsService],
})
export class IntegrationsModule {}
