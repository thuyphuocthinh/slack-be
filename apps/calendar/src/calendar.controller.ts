import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { CalendarService } from './calendar.service';
import { WorkShiftService } from './services/work-shift.service';
import { CALENDAR_MESSAGE_PATTERNS } from '@slack/constants';
import { 
  BulkRegisterWorkShiftDto, GetWorkShiftsDto, UpdateWorkShiftDto, DeleteWorkShiftDto,
  GetCalendarPolicyDto, CreateCalendarPolicyDto, UpdateCalendarPolicyDto, DeleteCalendarPolicyDto 
} from './dto/calendar-request.dto';
import { WorkspaceCalendarPolicyService } from './services/workspace-calendar-policy.service';

@Controller()
export class CalendarController {
  constructor(
    private readonly calendarService: CalendarService,
    private readonly workShiftService: WorkShiftService,
    private readonly policyService: WorkspaceCalendarPolicyService,
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
}
