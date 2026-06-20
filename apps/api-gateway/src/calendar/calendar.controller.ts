import { Body, Controller, Get, Param, Post, Put, Delete, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CalendarService } from './calendar.service';
import { BulkRegisterWorkShiftApiDto, GetWorkShiftsApiDto, UpdateWorkShiftApiDto, UpsertCalendarPolicyApiDto } from './dto/calendar-api.dto';
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

  @Put('work-shifts/:id')
  @ApiOperation({ summary: 'Update a work shift' })
  async updateWorkShift(
    @Param('workspaceId') workspaceId: string,
    @Param('id') id: string,
    @CurrentUser() user: JwtUser,
    @Body() dto: UpdateWorkShiftApiDto,
  ) {
    return this.calendarService.updateWorkShift(id, workspaceId, user.sub!, dto);
  }

  @Delete('work-shifts/:id')
  @ApiOperation({ summary: 'Delete a work shift' })
  async deleteWorkShift(
    @Param('workspaceId') workspaceId: string,
    @Param('id') id: string,
    @CurrentUser() user: JwtUser,
  ) {
    return this.calendarService.deleteWorkShift(id, workspaceId, user.sub!);
  }

  @Get('policy')
  @ApiOperation({ summary: 'Get workspace calendar policy' })
  async getPolicy(@Param('workspaceId') workspaceId: string) {
    return this.calendarService.getPolicy(workspaceId);
  }

  @Post('policy')
  @ApiOperation({ summary: 'Create workspace calendar policy (Admin/Manager only)' })
  async createPolicy(
    @Param('workspaceId') workspaceId: string,
    @CurrentUser() user: JwtUser,
    @Body() dto: UpsertCalendarPolicyApiDto,
  ) {
    return this.calendarService.createPolicy(workspaceId, user.sub!, dto);
  }

  @Put('policy')
  @ApiOperation({ summary: 'Update workspace calendar policy (Admin/Manager only)' })
  async updatePolicy(
    @Param('workspaceId') workspaceId: string,
    @CurrentUser() user: JwtUser,
    @Body() dto: UpsertCalendarPolicyApiDto,
  ) {
    return this.calendarService.updatePolicy(workspaceId, user.sub!, dto);
  }

  @Delete('policy')
  @ApiOperation({ summary: 'Delete workspace calendar policy (Admin/Manager only)' })
  async deletePolicy(
    @Param('workspaceId') workspaceId: string,
    @CurrentUser() user: JwtUser,
  ) {
    return this.calendarService.deletePolicy(workspaceId, user.sub!);
  }
}
