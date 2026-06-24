import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CalendarSyncMappingEntity } from './entity/calendar-sync-mapping.entity';
import { GoogleCalendarProvider } from './providers/google-calendar.provider';
import { AuthService } from '../auth/auth.service';
import { IntegrationProvider, CalendarSyncStatus } from '@slack/constants';
import { ISyncCalendarShiftJobData, IDeleteCalendarShiftJobData } from '@slack/queue';

@Injectable()
export class SyncService {
  private readonly logger = new Logger(SyncService.name);

  constructor(
    @InjectRepository(CalendarSyncMappingEntity)
    private readonly mappingRepo: Repository<CalendarSyncMappingEntity>,
    private readonly googleCalendarProvider: GoogleCalendarProvider,
    private readonly authService: AuthService,
  ) {}

  async syncShiftToGoogleCalendar(data: ISyncCalendarShiftJobData) {
    const connection = await this.authService.getConnectionByProvider(data.userId, IntegrationProvider.GOOGLE);
    if (!connection) {
       this.logger.debug(`User ${data.userId} not connected to Google Calendar. Skipping sync.`);
       return;
    }

    // Wrap in transaction to apply pessimistic lock, preventing concurrent jobs for the same shift
    await this.mappingRepo.manager.transaction(async (manager) => {
      // 1. Upsert mapping safely
      let mapping = await manager.findOne(CalendarSyncMappingEntity, {
        where: { integrationId: connection.id, shiftId: data.shiftId },
        lock: { mode: 'pessimistic_write' },
      });

      if (!mapping) {
        try {
          mapping = manager.create(CalendarSyncMappingEntity, {
            integrationId: connection.id,
            shiftId: data.shiftId,
          });
          mapping = await manager.save(mapping);
        } catch (error) {
          // If unique constraint violation, another process inserted it, fetch it with lock
          mapping = await manager.findOne(CalendarSyncMappingEntity, {
            where: { integrationId: connection.id, shiftId: data.shiftId },
            lock: { mode: 'pessimistic_write' },
          });
          if (!mapping) throw error;
        }
      }

      // 2. Deterministic Google Event ID
      const googleEventId = mapping.id.replace(/-/g, '');

      const accessToken = await this.authService.getValidAccessToken(connection.id);

      const eventParams = {
        summary: `Work Shift - ${data.location}`,
        start: { dateTime: new Date(data.startDate).toISOString() },
        end: { dateTime: new Date(data.endDate).toISOString() },
      };

      try {
        if (mapping.externalEventId) {
          // Update existing event
          await this.googleCalendarProvider.updateEvent(accessToken, googleEventId, eventParams);
        } else {
          // Create new event
          try {
            await this.googleCalendarProvider.createEvent(accessToken, googleEventId, eventParams);
          } catch (err) {
            if (err.code === 409) {
              this.logger.warn(`Event ${googleEventId} already exists, updating instead (Idempotency)`);
              await this.googleCalendarProvider.updateEvent(accessToken, googleEventId, eventParams);
            } else {
              throw err;
            }
          }
        }

        mapping.externalEventId = googleEventId;
        mapping.syncStatus = CalendarSyncStatus.SUCCESS;
        mapping.lastSyncedAt = new Date();
        mapping.lastError = null;
        await manager.save(mapping);
      } catch (error) {
         this.logger.error(`Failed to sync shift ${data.shiftId} to GCAL: ${error.message}`);
         mapping.syncStatus = CalendarSyncStatus.FAILED;
         mapping.lastError = error.message;
         await manager.save(mapping);
         throw error; // Let BullMQ retry
      }
    });
  }

  async deleteShiftFromGoogleCalendar(data: IDeleteCalendarShiftJobData) {
     const connection = await this.authService.getConnectionByProvider(data.userId, IntegrationProvider.GOOGLE);
     if (!connection) return;

     const mapping = await this.mappingRepo.findOne({
       where: { integrationId: connection.id, shiftId: data.shiftId }
     });

     if (!mapping) return; 

     // The event ID is deterministic
     const googleEventId = mapping.id.replace(/-/g, '');

     try {
       const accessToken = await this.authService.getValidAccessToken(connection.id);
       await this.googleCalendarProvider.deleteEvent(accessToken, googleEventId);
     } catch (error) {
       if (error.code === 404 || error.code === 410) {
           this.logger.debug(`Event ${googleEventId} already deleted on GCAL`);
       } else {
           this.logger.error(`Failed to delete event ${googleEventId}: ${error.message}`);
           throw error; 
       }
     }

     await this.mappingRepo.remove(mapping);
  }
}
