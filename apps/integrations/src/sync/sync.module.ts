import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CalendarSyncMappingEntity } from './entity/calendar-sync-mapping.entity';
import { SyncService } from './sync.service';
import { SyncProcessor } from './sync.processor';
import { GoogleCalendarProvider } from './providers/google-calendar.provider';
import { AuthModule } from '../auth/auth.module';
import { QueueModule, EQueueName } from '@slack/queue';

@Module({
  imports: [
    TypeOrmModule.forFeature([CalendarSyncMappingEntity]),
    AuthModule,
    QueueModule.forRoot(),
    QueueModule.forFeature([EQueueName.INTEGRATION_SYNC_QUEUE]),
  ],
  controllers: [],
  providers: [
    SyncService,
    SyncProcessor,
    GoogleCalendarProvider,
  ],
  exports: [SyncService],
})
export class SyncModule { }
