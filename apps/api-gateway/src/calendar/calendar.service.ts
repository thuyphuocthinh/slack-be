import { Inject, Injectable, Logger } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { NAME_SERVICE_TCP, CALENDAR_MESSAGE_PATTERNS } from '@slack/constants';
import { firstValueFrom } from 'rxjs';
import { v2 as cloudinary } from 'cloudinary';
import { MicroserviceErrorHandler } from '../common/microservice_error.handler';
import { BulkRegisterWorkShiftApiDto, CheckInApiDto, GetWorkShiftsApiDto, UpdateWorkShiftApiDto, UpsertCalendarPolicyApiDto } from './dto/calendar-api.dto';

@Injectable()
export class CalendarService {
  private readonly logger = new Logger(CalendarService.name);

  constructor(
    @Inject(NAME_SERVICE_TCP.CALENDAR_SERVICE)
    private readonly calendarClient: ClientProxy,
    @Inject('CLOUDINARY')
    private readonly cloudinaryClient: typeof cloudinary,
  ) {}

  async bulkRegisterShifts(
    workspaceId: string,
    userId: string,
    dto: BulkRegisterWorkShiftApiDto,
  ) {
    const payload = {
      workspaceId,
      requestorId: userId,
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

  async getWorkShifts(workspaceId: string, requestorId: string, query: GetWorkShiftsApiDto) {
    const payload = {
      workspaceId,
      requestorId,
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
      requestorId: userId,
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
      requestorId: userId,
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

  async createRequest(workspaceId: string, userId: string, dto: any) {
    const payload = {
      workspaceId,
      userId,
      ...dto,
    };

    return MicroserviceErrorHandler.handleAsyncCall(
      () =>
        firstValueFrom(
          this.calendarClient.send(
            CALENDAR_MESSAGE_PATTERNS.CREATE_LEAVE_REQUEST,
            payload,
          ),
        ),
      'createRequest',
      'CalendarService',
    );
  }

  async updateRequest(id: string, workspaceId: string, userId: string, dto: any) {
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
            CALENDAR_MESSAGE_PATTERNS.UPDATE_LEAVE_REQUEST,
            payload,
          ),
        ),
      'updateRequest',
      'CalendarService',
    );
  }

  async deleteRequest(id: string, workspaceId: string, userId: string) {
    const payload = {
      id,
      workspaceId,
      userId,
    };

    return MicroserviceErrorHandler.handleAsyncCall(
      () =>
        firstValueFrom(
          this.calendarClient.send(
            CALENDAR_MESSAGE_PATTERNS.DELETE_LEAVE_REQUEST,
            payload,
          ),
        ),
      'deleteRequest',
      'CalendarService',
    );
  }

  async getRequests(workspaceId: string, userId: string, query: any) {
    const payload = {
      workspaceId,
      userId,
      ...query,
    };

    return MicroserviceErrorHandler.handleAsyncCall(
      () =>
        firstValueFrom(
          this.calendarClient.send(
            CALENDAR_MESSAGE_PATTERNS.GET_LEAVE_REQUESTS,
            payload,
          ),
        ),
      'getRequests',
      'CalendarService',
    );
  }

  async reviewRequest(id: string, workspaceId: string, reviewerId: string, dto: any) {
    const payload = {
      id,
      workspaceId,
      reviewerId,
      ...dto,
    };

    return MicroserviceErrorHandler.handleAsyncCall(
      () =>
        firstValueFrom(
          this.calendarClient.send(
            CALENDAR_MESSAGE_PATTERNS.REVIEW_CALENDAR_REQUEST,
            payload,
          ),
        ),
      'reviewRequest',
      'CalendarService',
    );
  }

  async manualUnlock(workspaceId: string, reviewerId: string, dto: any) {
    const payload = {
      workspaceId,
      reviewerId,
      targetUserId: dto.targetUserId,
      targetMonth: dto.targetMonth,
      reason: dto.reason,
    };

    return MicroserviceErrorHandler.handleAsyncCall(
      () =>
        firstValueFrom(
          this.calendarClient.send(
            CALENDAR_MESSAGE_PATTERNS.UNLOCK_USER_CALENDAR,
            payload,
          ),
        ),
      'manualUnlock',
      'CalendarService',
    );
  }

  private async uploadFaceImage(base64: string): Promise<string | undefined> {
    try {
      const result = await this.cloudinaryClient.uploader.upload(base64, {
        resource_type: 'image',
        folder: 'attendance/faces',
      });
      return result.secure_url;
    } catch (err) {
      this.logger.warn('Face image upload failed, continuing without image:', err?.message);
      return undefined;
    }
  }

  async checkIn(workspaceId: string, userId: string, clientIp: string, dto: CheckInApiDto) {
    let faceImageKey: string | undefined;
    if (dto.location === 'WFH' && dto.faceImageBase64) {
      faceImageKey = await this.uploadFaceImage(dto.faceImageBase64);
    }

    return MicroserviceErrorHandler.handleAsyncCall(
      () =>
        firstValueFrom(
          this.calendarClient.send(CALENDAR_MESSAGE_PATTERNS.CHECK_IN, {
            workspaceId,
            userId,
            location: dto.location,
            shiftId: dto.shiftId,
            ipAddress: clientIp,
            faceImageKey,
            faceSimilarityScore: dto.faceSimilarityScore,
          }),
        ),
      'checkIn',
      'CalendarService',
    );
  }

  async checkOut(workspaceId: string, userId: string, clientIp: string, dto: CheckInApiDto) {
    let faceImageKey: string | undefined;
    if (dto.location === 'WFH' && dto.faceImageBase64) {
      faceImageKey = await this.uploadFaceImage(dto.faceImageBase64);
    }

    return MicroserviceErrorHandler.handleAsyncCall(
      () =>
        firstValueFrom(
          this.calendarClient.send(CALENDAR_MESSAGE_PATTERNS.CHECK_OUT, {
            workspaceId,
            userId,
            location: dto.location,
            shiftId: dto.shiftId,
            ipAddress: clientIp,
            faceImageKey,
            faceSimilarityScore: dto.faceSimilarityScore,
          }),
        ),
      'checkOut',
      'CalendarService',
    );
  }

  async getTodayAttendance(workspaceId: string, userId: string) {
    return MicroserviceErrorHandler.handleAsyncCall(
      () =>
        firstValueFrom(
          this.calendarClient.send(CALENDAR_MESSAGE_PATTERNS.GET_TODAY_ATTENDANCE, {
            workspaceId,
            userId,
          }),
        ),
      'getTodayAttendance',
      'CalendarService',
    );
  }
}
