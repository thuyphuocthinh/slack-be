import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CalendarService } from './calendar.service';
import { BulkRegisterWorkShiftApiDto, GetWorkShiftsApiDto } from './dto/calendar-api.dto';
import { CurrentUser, type JwtUser } from '@slack/common';

@ApiTags('Calendar')
@Controller('workspaces/:workspaceId/calendar')
@ApiBearerAuth()
export class CalendarController {
  constructor(private readonly calendarService: CalendarService) { }

  @Post('bulk-register')
  @ApiOperation({ summary: 'Bulk register work shifts for a user' })
  async bulkRegisterShifts(
    @Param('workspaceId') workspaceId: string,
    @CurrentUser() user: JwtUser,
    @Body() dto: BulkRegisterWorkShiftApiDto,
  ) {
    return this.calendarService.bulkRegisterShifts(workspaceId, user.sub!, dto);
  }

  @Get('work-shifts')
  @ApiOperation({ summary: 'Get list of work shifts with filters' })
  async getWorkShifts(
    @Param('workspaceId') workspaceId: string,
    @Query() query: GetWorkShiftsApiDto,
  ) {
    return this.calendarService.getWorkShifts(workspaceId, query);
  }
}
