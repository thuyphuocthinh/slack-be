import { Inject, Injectable } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { NAME_SERVICE_TCP, CALENDAR_MESSAGE_PATTERNS } from '@slack/constants';
import { firstValueFrom } from 'rxjs';
import { MicroserviceErrorHandler } from '../common/microservice_error.handler';
import { BulkRegisterWorkShiftApiDto, GetWorkShiftsApiDto } from './dto/calendar-api.dto';

@Injectable()
export class CalendarService {
  constructor(
    @Inject(NAME_SERVICE_TCP.CALENDAR_SERVICE)
    private readonly calendarClient: ClientProxy,
  ) {}

  async bulkRegisterShifts(
    workspaceId: string,
    userId: string,
    dto: BulkRegisterWorkShiftApiDto,
  ) {
    const payload = {
      workspaceId,
      userId: dto.userId || userId,
      shifts: dto.shifts,
      location: dto.location,
    };

    return MicroserviceErrorHandler.handleAsyncCall(
      () =>
        firstValueFrom(
          this.calendarClient.send(
            CALENDAR_MESSAGE_PATTERNS.BULK_REGISTER_SHIFTS,
            payload,
          ),
        ),
      'bulkRegisterShifts',
      'CalendarService',
    );
  }

  async getWorkShifts(workspaceId: string, query: GetWorkShiftsApiDto) {
    const payload = {
      workspaceId,
      startDate: query.startDate,
      endDate: query.endDate,
      userId: query.userId,
    };

    return MicroserviceErrorHandler.handleAsyncCall(
      () =>
        firstValueFrom(
          this.calendarClient.send(
            CALENDAR_MESSAGE_PATTERNS.GET_ALL_SHIFTS,
            payload,
          ),
        ),
      'getWorkShifts',
      'CalendarService',
    );
  }
}
