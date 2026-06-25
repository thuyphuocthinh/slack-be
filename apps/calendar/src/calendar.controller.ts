import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { CalendarService } from './calendar.service';
import { WorkShiftService } from './services/work-shift.service';
import { CALENDAR_MESSAGE_PATTERNS } from '@slack/constants';
import {
  BulkRegisterWorkShiftDto, GetWorkShiftsDto, UpdateWorkShiftDto, DeleteWorkShiftDto,
  GetCalendarPolicyDto, CreateCalendarPolicyDto, UpdateCalendarPolicyDto, DeleteCalendarPolicyDto,
  CheckInDto, CheckOutDto, GetTodayAttendanceDto, SaveFaceBaselineDto,
} from './dto/calendar-request.dto';
import { WorkspaceCalendarPolicyService } from './services/workspace-calendar-policy.service';
import { CalendarRequestService } from './services/calendar-request.service';
import { AttendanceService } from './services/attendance.service';
import { LeaveBalanceService } from './services/leave-balance.service';
import { CreateCalendarRequestDto, UpdateCalendarRequestDto, DeleteCalendarRequestDto, GetCalendarRequestsDto, ReviewCalendarRequestDto, ManualUnlockCalendarDto, GetMyLeaveBalanceDto, GetWorkspaceLeaveBalancesDto, GetPersonalStatisticSummaryDto, GetPersonalChartDataDto, GetWorkspaceStatisticMembersDto, ExportWorkspaceStatisticExcelDto, SyncCalendarDto, GetHolidaysDto, CreateHolidayDto, UpdateHolidayDto, DeleteHolidayDto, AutoFillHolidaysDto } from './dto/calendar-request.dto';
import { AttendanceStatisticService } from './services/attendance-statistic.service';
import { WorkspaceHolidayService } from './services/workspace-holiday.service';

@Controller()
export class CalendarController {
  constructor(
    private readonly calendarService: CalendarService,
    private readonly workShiftService: WorkShiftService,
    private readonly policyService: WorkspaceCalendarPolicyService,
    private readonly requestService: CalendarRequestService,
    private readonly attendanceService: AttendanceService,
    private readonly leaveBalanceService: LeaveBalanceService,
    private readonly statisticService: AttendanceStatisticService,
    private readonly holidayService: WorkspaceHolidayService,
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

  @MessagePattern(CALENDAR_MESSAGE_PATTERNS.SYNC_CALENDAR)
  async syncCalendar(@Payload() dto: SyncCalendarDto) {
    return this.workShiftService.syncCalendar(dto);
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

  @MessagePattern(CALENDAR_MESSAGE_PATTERNS.SAVE_FACE_BASELINE)
  async saveFaceBaseline(@Payload() dto: SaveFaceBaselineDto) {
    return this.attendanceService.saveFaceBaseline(dto);
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

  @MessagePattern(CALENDAR_MESSAGE_PATTERNS.GET_MY_LEAVE_BALANCE)
  async getMyLeaveBalance(@Payload() dto: GetMyLeaveBalanceDto) {
    return this.leaveBalanceService.getMyLeaveBalance(dto.workspaceId, dto.userId, dto.year);
  }

  @MessagePattern(CALENDAR_MESSAGE_PATTERNS.GET_WORKSPACE_LEAVE_BALANCES)
  async getWorkspaceLeaveBalances(@Payload() dto: GetWorkspaceLeaveBalancesDto) {
    return this.leaveBalanceService.getWorkspaceLeaveBalances(dto.workspaceId, dto.requestorId, dto.year);
  }
  @MessagePattern(CALENDAR_MESSAGE_PATTERNS.GET_PERSONAL_STATISTIC_SUMMARY)
  async getPersonalStatisticSummary(@Payload() dto: GetPersonalStatisticSummaryDto) {
    return this.statisticService.getPersonalSummary(dto.workspaceId, dto.userId, dto.startDate, dto.endDate);
  }

  @MessagePattern(CALENDAR_MESSAGE_PATTERNS.GET_PERSONAL_CHART_DATA)
  async getPersonalChartData(@Payload() dto: GetPersonalChartDataDto) {
    return this.statisticService.getPersonalChartData(dto.workspaceId, dto.userId, dto.startDate, dto.endDate);
  }

  @MessagePattern(CALENDAR_MESSAGE_PATTERNS.GET_WORKSPACE_STATISTIC_MEMBERS)
  async getWorkspaceStatisticMembers(@Payload() dto: GetWorkspaceStatisticMembersDto) {
    return this.statisticService.getWorkspaceMembers(dto.workspaceId, dto.month);
  }

  @MessagePattern(CALENDAR_MESSAGE_PATTERNS.EXPORT_WORKSPACE_STATISTIC_EXCEL)
  async exportWorkspaceStatisticExcel(@Payload() dto: ExportWorkspaceStatisticExcelDto) {
    // Return base64 or buffer. We'll return buffer directly
    // since NestJS microservices can serialize Buffer.
    const buffer = await this.statisticService.exportWorkspaceExcel(dto.workspaceId, dto.month);
    return buffer.toString('base64');
  }

  @MessagePattern(CALENDAR_MESSAGE_PATTERNS.GET_HOLIDAYS)
  async getHolidays(@Payload() dto: GetHolidaysDto) {
    return this.holidayService.getHolidays(dto.workspaceId, dto.year);
  }

  @MessagePattern(CALENDAR_MESSAGE_PATTERNS.CREATE_HOLIDAY)
  async createHoliday(@Payload() dto: CreateHolidayDto) {
    return this.holidayService.createHoliday(dto);
  }

  @MessagePattern(CALENDAR_MESSAGE_PATTERNS.UPDATE_HOLIDAY)
  async updateHoliday(@Payload() dto: UpdateHolidayDto) {
    return this.holidayService.updateHoliday(dto);
  }

  @MessagePattern(CALENDAR_MESSAGE_PATTERNS.DELETE_HOLIDAY)
  async deleteHoliday(@Payload() dto: DeleteHolidayDto) {
    return this.holidayService.deleteHoliday(dto);
  }

  @MessagePattern(CALENDAR_MESSAGE_PATTERNS.AUTO_FILL_HOLIDAYS)
  async autoFillHolidays(@Payload() dto: AutoFillHolidaysDto) {
    return this.holidayService.autoFillHolidays(dto);
  }
}
