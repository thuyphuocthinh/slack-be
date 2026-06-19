import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { CalendarService } from './calendar.service';
import { WorkShiftService } from './services/work-shift.service';
import { CALENDAR_MESSAGE_PATTERNS } from '@slack/constants';
import { BulkRegisterWorkShiftDto, GetWorkShiftsDto } from './dto/calendar-request.dto';

@Controller()
export class CalendarController {
  constructor(
    private readonly calendarService: CalendarService,
    private readonly workShiftService: WorkShiftService,
  ) {}

  @MessagePattern(CALENDAR_MESSAGE_PATTERNS.BULK_REGISTER_SHIFTS)
  async bulkRegisterShifts(@Payload() dto: BulkRegisterWorkShiftDto) {
    return this.workShiftService.bulkRegisterShifts(dto);
  }

  @MessagePattern(CALENDAR_MESSAGE_PATTERNS.GET_ALL_SHIFTS)
  async getWorkShifts(@Payload() dto: GetWorkShiftsDto) {
    return this.workShiftService.getWorkShifts(dto);
  }
}
