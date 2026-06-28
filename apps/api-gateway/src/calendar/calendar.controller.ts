import { Body, Controller, Get, Param, Post, Put, Delete, Query, Ip, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CalendarService } from './calendar.service';
import { BulkRegisterWorkShiftApiDto, CheckInApiDto, GetWorkShiftsApiDto, UpdateWorkShiftApiDto, UpsertCalendarPolicyApiDto, CreateCalendarRequestApiDto, UpdateCalendarRequestApiDto, GetCalendarRequestsApiDto, ReviewCalendarRequestApiDto, ManualUnlockCalendarApiDto, CreateHolidayApiDto, UpdateHolidayApiDto, AutoFillHolidaysApiDto, SaveFaceBaselineApiDto } from './dto/calendar-api.dto';
import { CurrentUser, type JwtUser } from '@slack/common';
import { RateLimit } from '../common/guards/rate-limit.decorator';

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
    @CurrentUser() user: JwtUser,
    @Query() query: GetWorkShiftsApiDto,
  ) {
    return this.calendarService.getWorkShifts(workspaceId, user.sub!, query);
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

  @Post('work-shifts/sync')
  @ApiOperation({ summary: 'Bulk sync all work shifts to connected integrations (e.g., Google Calendar)' })
  async syncCalendar(
    @Param('workspaceId') workspaceId: string,
    @CurrentUser() user: JwtUser,
  ) {
    return this.calendarService.syncCalendar(workspaceId, user.sub!);
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

  @Post('requests')
  @ApiOperation({ summary: 'Create a calendar request (Leave, Unlock, etc.)' })
  async createRequest(
    @Param('workspaceId') workspaceId: string,
    @CurrentUser() user: JwtUser,
    @Body() dto: CreateCalendarRequestApiDto,
  ) {
    return this.calendarService.createRequest(workspaceId, user.sub!, dto);
  }

  @Put('requests/:id')
  @ApiOperation({ summary: 'Update a calendar request (Only if PENDING)' })
  async updateRequest(
    @Param('workspaceId') workspaceId: string,
    @Param('id') id: string,
    @CurrentUser() user: JwtUser,
    @Body() dto: UpdateCalendarRequestApiDto,
  ) {
    return this.calendarService.updateRequest(id, workspaceId, user.sub!, dto);
  }

  @Delete('requests/:id')
  @ApiOperation({ summary: 'Delete a calendar request (Only if PENDING)' })
  async deleteRequest(
    @Param('workspaceId') workspaceId: string,
    @Param('id') id: string,
    @CurrentUser() user: JwtUser,
  ) {
    return this.calendarService.deleteRequest(id, workspaceId, user.sub!);
  }

  @Get('requests')
  @ApiOperation({ summary: 'Get calendar requests with pagination and optional user filtering' })
  async getRequests(
    @Param('workspaceId') workspaceId: string,
    @CurrentUser() user: JwtUser,
    @Query() query: GetCalendarRequestsApiDto,
  ) {
    return this.calendarService.getRequests(workspaceId, user.sub!, query);
  }

  @Put('requests/:id/review')
  @ApiOperation({ summary: 'Approve or Reject a calendar request (Manager/Admin only)' })
  async reviewRequest(
    @Param('workspaceId') workspaceId: string,
    @Param('id') id: string,
    @CurrentUser() user: JwtUser,
    @Body() dto: ReviewCalendarRequestApiDto,
  ) {
    return this.calendarService.reviewRequest(id, workspaceId, user.sub!, dto);
  }

  @Get('my-lock-status')
  @ApiOperation({ summary: 'Lấy trạng thái mở khóa cá nhân của tháng hiện tại (dành cho mọi user)' })
  async getMyLockStatus(
    @Param('workspaceId') workspaceId: string,
    @CurrentUser() user: JwtUser,
    @Query('targetMonth') targetMonth: string,
  ) {
    return this.calendarService.getMyLockStatus(workspaceId, user.sub!, targetMonth);
  }

  @Get('lock-status')
  @ApiOperation({ summary: 'Get active unlock status for all members in a given month (Manager/Admin only)' })
  async getMonthLockStatus(
    @Param('workspaceId') workspaceId: string,
    @CurrentUser() user: JwtUser,
    @Query('targetMonth') targetMonth: string,
  ) {
    return this.calendarService.getMonthLockStatus(workspaceId, user.sub!, targetMonth);
  }

  @Post('manual-unlock')
  @ApiOperation({ summary: 'Manually unlock calendar for a specific user (Manager/Admin only)' })
  async manualUnlock(
    @Param('workspaceId') workspaceId: string,
    @CurrentUser() user: JwtUser,
    @Body() dto: ManualUnlockCalendarApiDto,
  ) {
    return this.calendarService.manualUnlock(workspaceId, user.sub!, dto);
  }

  @Post('face-baseline')
  @ApiOperation({ summary: 'Save or update face baseline for the current user (required for WFH check-in)' })
  async saveFaceBaseline(
    @Param('workspaceId') workspaceId: string,
    @CurrentUser() user: JwtUser,
    @Body() dto: SaveFaceBaselineApiDto,
  ) {
    return this.calendarService.saveFaceBaseline(workspaceId, user.sub!, dto);
  }

  @Post('check-in')
  @RateLimit({ limit: 5, window: 60 })
  @ApiOperation({ summary: 'Record check-in (OFFICE validates IP, WFH requires face similarity)' })
  async checkIn(
    @Param('workspaceId') workspaceId: string,
    @CurrentUser() user: JwtUser,
    @Ip() ip: string,
    @Body() dto: CheckInApiDto,
  ) {
    return this.calendarService.checkIn(workspaceId, user.sub!, ip, dto);
  }

  @Post('check-out')
  @RateLimit({ limit: 5, window: 60 })
  @ApiOperation({ summary: 'Record check-out' })
  async checkOut(
    @Param('workspaceId') workspaceId: string,
    @CurrentUser() user: JwtUser,
    @Ip() ip: string,
    @Body() dto: CheckInApiDto,
  ) {
    return this.calendarService.checkOut(workspaceId, user.sub!, ip, dto);
  }

  @Get('today-attendance')
  @ApiOperation({ summary: 'Get today check-in / check-out status for current user' })
  async getTodayAttendance(
    @Param('workspaceId') workspaceId: string,
    @CurrentUser() user: JwtUser,
    @Query('clientDate') clientDate: string,
  ) {
    return this.calendarService.getTodayAttendance(workspaceId, user.sub!, clientDate);
  }

  @Get('leave-balances/my-balance')
  @ApiOperation({ summary: 'Get current user leave balance for the specified year' })
  async getMyLeaveBalance(
    @Param('workspaceId') workspaceId: string,
    @Query('year') year: string,
    @CurrentUser() user: JwtUser,
  ) {
    const targetYear = year ? parseInt(year, 10) : new Date().getFullYear();
    return this.calendarService.getMyLeaveBalance(workspaceId, user.sub!, targetYear);
  }

  @Get('statistics/me/summary')
  @ApiOperation({ summary: 'Get personal statistics summary (Role Member)' })
  async getPersonalStatisticSummary(
    @Param('workspaceId') workspaceId: string,
    @CurrentUser() user: JwtUser,
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
    @Query('userId') targetUserId?: string,
  ) {
    return this.calendarService.getPersonalStatisticSummary(workspaceId, user.sub!, targetUserId || user.sub!, startDate, endDate);
  }

  @Get('statistics/me/chart')
  @ApiOperation({ summary: 'Get personal chart data (Role Member)' })
  async getPersonalChartData(
    @Param('workspaceId') workspaceId: string,
    @CurrentUser() user: JwtUser,
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
    @Query('userId') targetUserId?: string,
  ) {
    return this.calendarService.getPersonalChartData(workspaceId, user.sub!, targetUserId || user.sub!, startDate, endDate);
  }

  @Get('statistics/workspace/members')
  @ApiOperation({ summary: 'Get workspace members statistics (Role Admin)' })
  async getWorkspaceStatisticMembers(
    @Param('workspaceId') workspaceId: string,
    @CurrentUser() user: JwtUser,
    @Query('month') month: string, // format YYYY-MM
  ) {
    return this.calendarService.getWorkspaceStatisticMembers(workspaceId, user.sub!, month);
  }

  @Get('statistics/workspace/export')
  @ApiOperation({ summary: 'Export workspace statistics to Excel (Role Admin)' })
  async exportWorkspaceStatisticExcel(
    @Param('workspaceId') workspaceId: string,
    @CurrentUser() user: JwtUser,
    @Query('month') month: string, // format YYYY-MM
    @Res() res: Response,
  ) {
    const base64Data = await this.calendarService.exportWorkspaceStatisticExcel(workspaceId, user.sub!, month);
    const buffer = Buffer.from(base64Data, 'base64');

    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename=Bang_Cham_Cong_Thang_${month}.xlsx`,
      'Content-Length': buffer.length,
    });

    res.end(buffer);
  }

  // --- HOLIDAYS ---

  @Get('holidays')
  @ApiOperation({ summary: 'Get workspace holidays for a specific year' })
  async getHolidays(
    @Param('workspaceId') workspaceId: string,
    @Query('year') year?: string,
  ) {
    const targetYear = year ? parseInt(year, 10) : new Date().getFullYear();
    return this.calendarService.getHolidays(workspaceId, targetYear);
  }

  @Post('holidays')
  @ApiOperation({ summary: 'Create a new holiday (Admin/Manager)' })
  async createHoliday(
    @Param('workspaceId') workspaceId: string,
    @CurrentUser() user: JwtUser,
    @Body() dto: CreateHolidayApiDto,
  ) {
    return this.calendarService.createHoliday(workspaceId, user.sub!, dto);
  }

  @Put('holidays/:id')
  @ApiOperation({ summary: 'Update a holiday (Admin/Manager)' })
  async updateHoliday(
    @Param('workspaceId') workspaceId: string,
    @Param('id') id: string,
    @CurrentUser() user: JwtUser,
    @Body() dto: UpdateHolidayApiDto,
  ) {
    return this.calendarService.updateHoliday(workspaceId, user.sub!, id, dto);
  }

  @Delete('holidays/:id')
  @ApiOperation({ summary: 'Delete a holiday (Admin/Manager)' })
  async deleteHoliday(
    @Param('workspaceId') workspaceId: string,
    @Param('id') id: string,
    @CurrentUser() user: JwtUser,
  ) {
    return this.calendarService.deleteHoliday(workspaceId, user.sub!, id);
  }

  @Post('holidays/auto-fill')
  @ApiOperation({ summary: 'Auto fill holidays for a specific country (Admin/Manager)' })
  async autoFillHolidays(
    @Param('workspaceId') workspaceId: string,
    @CurrentUser() user: JwtUser,
    @Body() dto: AutoFillHolidaysApiDto,
  ) {
    return this.calendarService.autoFillHolidays(workspaceId, user.sub!, dto);
  }
}

