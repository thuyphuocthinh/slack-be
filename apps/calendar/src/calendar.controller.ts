import { Controller, Get } from '@nestjs/common';
import { CalendarService } from './calendar.service';

@Controller()
export class CalendarController {
  constructor(private readonly calendarService: CalendarService) {}

  @Get()
  getHello(): string {
    return this.calendarService.getHello();
  }
}
