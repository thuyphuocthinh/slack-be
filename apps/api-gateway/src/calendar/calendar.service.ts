import { Inject, Injectable } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { NAME_SERVICE_TCP, CALENDAR_MESSAGE_PATTERNS } from '@slack/constants';
import { firstValueFrom } from 'rxjs';
import { MicroserviceErrorHandler } from '../common/microservice_error.handler';
import { BulkRegisterWorkShiftApiDto, GetWorkShiftsApiDto, UpdateWorkShiftApiDto, UpsertCalendarPolicyApiDto } from './dto/calendar-api.dto';

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

  async updateWorkShift(
    id: string,
    workspaceId: string,
    userId: string,
    dto: UpdateWorkShiftApiDto,
  ) {
    const payload = {
      id,
      workspaceId,
      userId,
      ...dto,
    };

    return MicroserviceErrorHandler.handleAsyncCall(
      () =>
        firstValueFrom(
          this.calendarClient.send(
            CALENDAR_MESSAGE_PATTERNS.UPDATE_WORK_SHIFT,
            payload,
          ),
        ),
      'updateWorkShift',
      'CalendarService',
    );
  }

  async deleteWorkShift(id: string, workspaceId: string, userId: string) {
    const payload = {
      id,
      workspaceId,
      userId,
    };

    return MicroserviceErrorHandler.handleAsyncCall(
      () =>
        firstValueFrom(
          this.calendarClient.send(
            CALENDAR_MESSAGE_PATTERNS.DELETE_WORK_SHIFT,
            payload,
          ),
        ),
      'deleteWorkShift',
      'CalendarService',
    );
  }

  async getPolicy(workspaceId: string) {
    return MicroserviceErrorHandler.handleAsyncCall(
      () =>
        firstValueFrom(
          this.calendarClient.send(
            CALENDAR_MESSAGE_PATTERNS.GET_CALENDAR_POLICY,
            { workspaceId },
          ),
        ),
      'getPolicy',
      'CalendarService',
    );
  }

  async createPolicy(workspaceId: string, userId: string, dto: UpsertCalendarPolicyApiDto) {
    const payload = {
      workspaceId,
      userId,
      policyData: dto.policyData,
    };

    return MicroserviceErrorHandler.handleAsyncCall(
      () =>
        firstValueFrom(
          this.calendarClient.send(
            CALENDAR_MESSAGE_PATTERNS.CREATE_CALENDAR_POLICY,
            payload,
          ),
        ),
      'createPolicy',
      'CalendarService',
    );
  }

  async updatePolicy(workspaceId: string, userId: string, dto: UpsertCalendarPolicyApiDto) {
    const payload = {
      workspaceId,
      userId,
      policyData: dto.policyData,
    };

    return MicroserviceErrorHandler.handleAsyncCall(
      () =>
        firstValueFrom(
          this.calendarClient.send(
            CALENDAR_MESSAGE_PATTERNS.UPDATE_CALENDAR_POLICY,
            payload,
          ),
        ),
      'updatePolicy',
      'CalendarService',
    );
  }

  async deletePolicy(workspaceId: string, userId: string) {
    const payload = {
      workspaceId,
      userId,
    };

    return MicroserviceErrorHandler.handleAsyncCall(
      () =>
        firstValueFrom(
          this.calendarClient.send(
            CALENDAR_MESSAGE_PATTERNS.DELETE_CALENDAR_POLICY,
            payload,
          ),
        ),
      'deletePolicy',
      'CalendarService',
    );
  }
}
