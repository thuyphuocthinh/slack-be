import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { CalendarService } from './calendar.service';
import { WorkShiftService } from './services/work-shift.service';
import { CALENDAR_MESSAGE_PATTERNS } from '@slack/constants';
import {
  BulkRegisterWorkShiftDto, GetWorkShiftsDto, UpdateWorkShiftDto, DeleteWorkShiftDto,
  GetCalendarPolicyDto, CreateCalendarPolicyDto, UpdateCalendarPolicyDto, DeleteCalendarPolicyDto,
  CheckInDto, CheckOutDto, GetTodayAttendanceDto,
} from './dto/calendar-request.dto';
import { WorkspaceCalendarPolicyService } from './services/workspace-calendar-policy.service';
import { CalendarRequestService } from './services/calendar-request.service';
import { AttendanceService } from './services/attendance.service';
import { CreateCalendarRequestDto, UpdateCalendarRequestDto, DeleteCalendarRequestDto, GetCalendarRequestsDto, ReviewCalendarRequestDto, ManualUnlockCalendarDto } from './dto/calendar-request.dto';

@Controller()
export class CalendarController {
  constructor(
    private readonly calendarService: CalendarService,
    private readonly workShiftService: WorkShiftService,
    private readonly policyService: WorkspaceCalendarPolicyService,
    private readonly requestService: CalendarRequestService,
    private readonly attendanceService: AttendanceService,
  ) {}

  @MessagePattern(CALENDAR_MESSAGE_PATTERNS.BULK_REGISTER_SHIFTS)
  async bulkRegisterShifts(@Payload() dto: BulkRegisterWorkShiftDto) {
    return this.workShiftService.bulkRegisterShifts(dto);
  }

  @MessagePattern(CALENDAR_MESSAGE_PATTERNS.GET_ALL_SHIFTS)
  async getWorkShifts(@Payload() dto: GetWorkShiftsDto) {
    return this.workShiftService.getWorkShifts(dto);
  }

  @MessagePattern(CALENDAR_MESSAGE_PATTERNS.UPDATE_WORK_SHIFT)
  async updateWorkShift(@Payload() dto: UpdateWorkShiftDto) {
    return this.workShiftService.updateWorkShift(dto);
  }

  @MessagePattern(CALENDAR_MESSAGE_PATTERNS.DELETE_WORK_SHIFT)
  async deleteWorkShift(@Payload() dto: DeleteWorkShiftDto) {
    return this.workShiftService.deleteWorkShift(dto);
  }

  @MessagePattern(CALENDAR_MESSAGE_PATTERNS.GET_CALENDAR_POLICY)
  async getPolicy(@Payload() dto: GetCalendarPolicyDto) {
    return this.policyService.getPolicy(dto.workspaceId);
  }

  @MessagePattern(CALENDAR_MESSAGE_PATTERNS.CREATE_CALENDAR_POLICY)
  async createPolicy(@Payload() dto: CreateCalendarPolicyDto) {
    return this.policyService.createPolicy(dto);
  }

  @MessagePattern(CALENDAR_MESSAGE_PATTERNS.UPDATE_CALENDAR_POLICY)
  async updatePolicy(@Payload() dto: UpdateCalendarPolicyDto) {
    return this.policyService.updatePolicy(dto);
  }

  @MessagePattern(CALENDAR_MESSAGE_PATTERNS.DELETE_CALENDAR_POLICY)
  async deletePolicy(@Payload() dto: DeleteCalendarPolicyDto) {
    return this.policyService.deletePolicy(dto);
  }

  @MessagePattern(CALENDAR_MESSAGE_PATTERNS.CREATE_LEAVE_REQUEST)
  async createRequest(@Payload() dto: CreateCalendarRequestDto) {
    return this.requestService.createRequest(dto);
  }

  @MessagePattern(CALENDAR_MESSAGE_PATTERNS.UPDATE_LEAVE_REQUEST)
  async updateRequest(@Payload() dto: UpdateCalendarRequestDto) {
    return this.requestService.updateRequest(dto);
  }

  @MessagePattern(CALENDAR_MESSAGE_PATTERNS.DELETE_LEAVE_REQUEST)
  async deleteRequest(@Payload() dto: DeleteCalendarRequestDto) {
    return this.requestService.deleteRequest(dto);
  }

  @MessagePattern(CALENDAR_MESSAGE_PATTERNS.GET_LEAVE_REQUESTS)
  async getRequests(@Payload() dto: GetCalendarRequestsDto) {
    return this.requestService.getRequests(dto);
  }

  @MessagePattern(CALENDAR_MESSAGE_PATTERNS.REVIEW_CALENDAR_REQUEST)
  async reviewRequest(@Payload() dto: ReviewCalendarRequestDto) {
    return this.requestService.reviewRequest(dto);
  }

  @MessagePattern(CALENDAR_MESSAGE_PATTERNS.UNLOCK_USER_CALENDAR)
  async manualUnlock(@Payload() dto: ManualUnlockCalendarDto) {
    return this.requestService.manualUnlock(dto);
  }

  @MessagePattern(CALENDAR_MESSAGE_PATTERNS.CHECK_IN)
  async checkIn(@Payload() dto: CheckInDto) {
    return this.attendanceService.checkIn(dto);
  }

  @MessagePattern(CALENDAR_MESSAGE_PATTERNS.CHECK_OUT)
  async checkOut(@Payload() dto: CheckOutDto) {
    return this.attendanceService.checkOut(dto);
  }

  @MessagePattern(CALENDAR_MESSAGE_PATTERNS.GET_TODAY_ATTENDANCE)
  async getTodayAttendance(@Payload() dto: GetTodayAttendanceDto) {
    return this.attendanceService.getTodayAttendance(dto);
  }
}
