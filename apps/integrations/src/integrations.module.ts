import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EQueueName, QueueModule } from '@slack/queue';
import { TypeOrmModule } from '@nestjs/typeorm';
import { IntegrationController } from './integration.controller';
import { IntegrationService } from './integration.service';
import { AiModule } from './ai/ai.module';
import { AuthModule } from './auth/auth.module';
import { DatabaseModule } from '@slack/database';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    DatabaseModule,
    QueueModule.forRoot(),
    QueueModule.forFeature([EQueueName.INCOMING_WEBHOOK_QUEUE]),
    AiModule,
    AuthModule,
  ],
  controllers: [IntegrationController],
  providers: [IntegrationService],
})
export class IntegrationsModule { }
