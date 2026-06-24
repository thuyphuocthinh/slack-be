import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EQueueName, QueueModule } from '@slack/queue';
import { TypeOrmModule } from '@nestjs/typeorm';
import { IntegrationController } from './integration.controller';
import { IntegrationService } from './integration.service';
import { AiModule } from './ai/ai.module';
import { AuthModule } from './auth/auth.module';
import { DatabaseModule } from '@slack/database';

import { SyncModule } from './sync/sync.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    DatabaseModule,
    QueueModule.forRoot(),
    QueueModule.forFeature([
      EQueueName.INCOMING_WEBHOOK_QUEUE,
      EQueueName.INTEGRATION_SYNC_QUEUE,
    ]),
    AiModule,
    AuthModule,
    SyncModule,
  ],
  controllers: [IntegrationController],
  providers: [IntegrationService],
})
export class IntegrationsModule { }
