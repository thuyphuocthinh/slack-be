import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsISO8601,
  IsNotEmpty,
  IsString,
  IsUUID,
  Matches,
  ValidateNested,
  IsOptional,
  IsNumber,
  IsInt,
  IsObject,
  Min,
  Max,
} from 'class-validator';
import { ShiftLocation, CalendarRequestType, CalendarRequestStatus, CalendarRequestAction } from '../types/calendar.enum';

export class ShiftItemDto {
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'workDate must be in YYYY-MM-DD format',
  })
  workDate: string;

  @IsString()
  @IsISO8601({ strict: true })
  @Matches(/Z$/, { message: 'startTime must be a strictly UTC ISO string ending with Z' })
  startTime: string;

  @IsString()
  @IsISO8601({ strict: true })
  @Matches(/Z$/, { message: 'endTime must be a strictly UTC ISO string ending with Z' })
  endTime: string;
}

export class BulkRegisterWorkShiftDto {
  @IsUUID()
  @IsNotEmpty()
  workspaceId: string;

  @IsUUID()
  @IsNotEmpty()
  requestorId: string;

  @IsUUID()
  @IsNotEmpty()
  userId: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ShiftItemDto)
  @IsNotEmpty()
  shifts: ShiftItemDto[];

  @IsEnum(ShiftLocation)
  @IsNotEmpty()
  location: ShiftLocation;
}

export class GetWorkShiftsDto {
  @IsUUID()
  @IsNotEmpty()
  workspaceId: string;

  @IsUUID()
  @IsNotEmpty()
  requestorId: string;

  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'startDate must be in YYYY-MM-DD format' })
  startDate: string;

  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'endDate must be in YYYY-MM-DD format' })
  endDate: string;

  @IsUUID()
  @IsOptional()
  userId?: string;
}

export class UpdateWorkShiftDto {
  @IsUUID()
  @IsNotEmpty()
  id: string;

  @IsUUID()
  @IsNotEmpty()
  workspaceId: string;

  @IsUUID()
  @IsNotEmpty()
  requestorId: string;

  @IsUUID()
  @IsNotEmpty()
  userId: string;

  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'workDate must be in YYYY-MM-DD format',
  })
  @IsOptional()
  workDate?: string;

  @IsString()
  @IsISO8601({ strict: true })
  @Matches(/Z$/, { message: 'startTime must be a strictly UTC ISO string ending with Z' })
  @IsOptional()
  startTime?: string;

  @IsString()
  @IsISO8601({ strict: true })
  @Matches(/Z$/, { message: 'endTime must be a strictly UTC ISO string ending with Z' })
  @IsOptional()
  endTime?: string;

  @IsEnum(ShiftLocation)
  @IsOptional()
  location?: ShiftLocation;

  @IsString()
  @IsOptional()
  notes?: string;
}

export class DeleteWorkShiftDto {
  @IsUUID()
  @IsNotEmpty()
  id: string;

  @IsUUID()
  @IsNotEmpty()
  workspaceId: string;

  @IsUUID()
  @IsNotEmpty()
  requestorId: string;

  @IsUUID()
  @IsNotEmpty()
  userId: string;
}

export class PolicyDataDto {
  @IsNumber()
  @IsOptional()
  maxWfhDaysPerWeek?: number;

  @IsNumber()
  @IsOptional()
  maxFullTimeHours?: number;

  @IsNumber()
  @IsOptional()
  maxPartTimeHours?: number;

  @IsNumber()
  @IsOptional()
  lockDeadlineDay?: number;

  @IsNumber()
  @IsOptional()
  maxPaidLeaveDaysPerYear?: number;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  allowedOfficeIps?: string[];

  @IsArray()
  @IsInt({ each: true })
  @IsOptional()
  workingDays?: number[];
}

export class GetCalendarPolicyDto {
  @IsUUID()
  @IsNotEmpty()
  workspaceId: string;
}

export class CreateCalendarPolicyDto {
  @IsUUID()
  @IsNotEmpty()
  workspaceId: string;

  @IsUUID()
  @IsNotEmpty()
  userId: string;

  @IsObject()
  @ValidateNested()
  @Type(() => PolicyDataDto)
  @IsNotEmpty()
  policyData: PolicyDataDto;
}

export class UpdateCalendarPolicyDto {
  @IsUUID()
  @IsNotEmpty()
  workspaceId: string;

  @IsUUID()
  @IsNotEmpty()
  userId: string;

  @IsObject()
  @ValidateNested()
  @Type(() => PolicyDataDto)
  @IsNotEmpty()
  policyData: PolicyDataDto;
}

export class DeleteCalendarPolicyDto {
  @IsUUID()
  @IsNotEmpty()
  workspaceId: string;

  @IsUUID()
  @IsNotEmpty()
  userId: string;
}

export class CreateCalendarRequestDto {
  @IsUUID()
  @IsNotEmpty()
  workspaceId: string;

  @IsUUID()
  @IsNotEmpty()
  userId: string;

  @IsEnum(CalendarRequestType)
  @IsNotEmpty()
  requestType: CalendarRequestType;

  @IsString()
  @IsISO8601({ strict: true })
  @Matches(/Z$/, { message: 'startTime must be a strictly UTC ISO string ending with Z' })
  @IsNotEmpty()
  startTime: string;

  @IsString()
  @IsISO8601({ strict: true })
  @Matches(/Z$/, { message: 'endTime must be a strictly UTC ISO string ending with Z' })
  @IsNotEmpty()
  endTime: string;

  @IsNumber()
  @Min(0)
  @IsOptional()
  durationDays?: number;

  @IsString()
  @IsNotEmpty()
  reason: string;

  @IsObject()
  @IsOptional()
  metaData?: Record<string, any>;
}

export class UpdateCalendarRequestDto {
  @IsUUID()
  @IsNotEmpty()
  id: string;

  @IsUUID()
  @IsNotEmpty()
  workspaceId: string;

  @IsUUID()
  @IsNotEmpty()
  userId: string;

  @IsEnum(CalendarRequestType)
  @IsOptional()
  requestType?: CalendarRequestType;

  @IsString()
  @IsISO8601({ strict: true })
  @Matches(/Z$/, { message: 'startTime must be a strictly UTC ISO string ending with Z' })
  @IsOptional()
  startTime?: string;

  @IsString()
  @IsISO8601({ strict: true })
  @Matches(/Z$/, { message: 'endTime must be a strictly UTC ISO string ending with Z' })
  @IsOptional()
  endTime?: string;

  @IsNumber()
  @Min(0)
  @IsOptional()
  durationDays?: number;

  @IsString()
  @IsOptional()
  reason?: string;

  @IsObject()
  @IsOptional()
  metaData?: Record<string, any>;
}

export class DeleteCalendarRequestDto {
  @IsUUID()
  @IsNotEmpty()
  id: string;

  @IsUUID()
  @IsNotEmpty()
  workspaceId: string;

  @IsUUID()
  @IsNotEmpty()
  userId: string;
}

export class GetCalendarRequestsDto {
  @IsUUID()
  @IsNotEmpty()
  workspaceId: string;

  @IsUUID()
  @IsNotEmpty()
  userId: string;

  @IsUUID()
  @IsOptional()
  targetUserId?: string;

  @IsEnum(CalendarRequestStatus)
  @IsOptional()
  status?: CalendarRequestStatus;

  @IsEnum(CalendarRequestType)
  @IsOptional()
  type?: CalendarRequestType;

  @IsNumber()
  @Min(1)
  @Type(() => Number)
  @IsOptional()
  page?: number = 1;

  @IsNumber()
  @Min(1)
  @Max(100)
  @Type(() => Number)
  @IsOptional()
  limit?: number = 20;
}

export class ReviewCalendarRequestDto {
  @IsUUID()
  @IsNotEmpty()
  id: string;

  @IsUUID()
  @IsNotEmpty()
  workspaceId: string;

  @IsUUID()
  @IsNotEmpty()
  reviewerId: string;

  @IsEnum(CalendarRequestAction)
  @IsNotEmpty()
  action: CalendarRequestAction;

  @IsString()
  @IsOptional()
  reviewNotes?: string;
}

export class CheckInDto {
  @IsUUID()
  @IsNotEmpty()
  workspaceId: string;

  @IsUUID()
  @IsNotEmpty()
  userId: string;

  @IsEnum(ShiftLocation)
  @IsNotEmpty()
  location: ShiftLocation;

  @IsUUID()
  @IsOptional()
  shiftId?: string;

  @IsString()
  @IsOptional()
  ipAddress?: string;

  @IsString()
  @IsOptional()
  faceImageKey?: string;

  @IsArray()
  @IsNumber({}, { each: true })
  @IsOptional()
  faceDescriptor?: number[];
}

export class CheckOutDto extends CheckInDto { }

export class GetTodayAttendanceDto {
  @IsUUID()
  @IsNotEmpty()
  workspaceId: string;

  @IsUUID()
  @IsNotEmpty()
  userId: string;

  @IsString()
  @IsNotEmpty()
  clientDate: string; // YYYY-MM-DD from client
}

export class ManualUnlockCalendarDto {
  @IsUUID()
  @IsNotEmpty()
  workspaceId: string;

  @IsUUID()
  @IsNotEmpty()
  reviewerId: string;

  @IsUUID()
  @IsNotEmpty()
  targetUserId: string;

  @IsString()
  @Matches(/^\d{4}-\d{2}$/, { message: 'targetMonth must be in YYYY-MM format' })
  @IsNotEmpty()
  targetMonth: string;

  @IsString()
  @IsOptional()
  reason?: string;
}

export class GetMyLockStatusDto {
  @IsUUID()
  @IsNotEmpty()
  workspaceId: string;

  @IsUUID()
  @IsNotEmpty()
  userId: string;

  @IsString()
  @Matches(/^\d{4}-\d{2}$/, { message: 'targetMonth must be in YYYY-MM format' })
  @IsNotEmpty()
  targetMonth: string;
}

export class GetMonthLockStatusDto {
  @IsUUID()
  @IsNotEmpty()
  workspaceId: string;

  @IsUUID()
  @IsNotEmpty()
  requestorId: string;

  @IsString()
  @Matches(/^\d{4}-\d{2}$/, { message: 'targetMonth must be in YYYY-MM format' })
  @IsNotEmpty()
  targetMonth: string;
}

export class GetMyLeaveBalanceDto {
  @IsUUID()
  @IsNotEmpty()
  workspaceId: string;

  @IsUUID()
  @IsNotEmpty()
  userId: string;

  @IsNumber()
  @IsNotEmpty()
  year: number;
}

export class GetWorkspaceLeaveBalancesDto {
  @IsUUID()
  @IsNotEmpty()
  workspaceId: string;

  @IsUUID()
  @IsNotEmpty()
  requestorId: string;

  @IsNumber()
  @IsNotEmpty()
  year: number;
}

export class GetPersonalStatisticSummaryDto {
  @IsUUID()
  @IsNotEmpty()
  workspaceId: string;

  @IsUUID()
  @IsNotEmpty()
  requestorId: string;

  @IsUUID()
  @IsNotEmpty()
  userId: string;

  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'startDate must be in YYYY-MM-DD format' })
  startDate: string;

  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'endDate must be in YYYY-MM-DD format' })
  endDate: string;
}

export class GetPersonalChartDataDto extends GetPersonalStatisticSummaryDto { }

export class GetWorkspaceStatisticMembersDto {
  @IsUUID()
  @IsNotEmpty()
  workspaceId: string;

  @IsUUID()
  @IsNotEmpty()
  requestorId: string;

  @IsString()
  @Matches(/^\d{4}-\d{2}$/, { message: 'month must be in YYYY-MM format' })
  month: string;
}

export class ExportWorkspaceStatisticExcelDto extends GetWorkspaceStatisticMembersDto { }

export class SyncCalendarDto {
  @IsUUID()
  @IsNotEmpty()
  workspaceId: string;

  @IsUUID()
  @IsNotEmpty()
  userId: string;
}

export class GetHolidaysDto {
  @IsUUID()
  @IsNotEmpty()
  workspaceId: string;

  @IsNumber()
  @IsNotEmpty()
  year: number;
}

export class CreateHolidayDto {
  @IsUUID()
  @IsNotEmpty()
  workspaceId: string;

  @IsUUID()
  @IsNotEmpty()
  requestorId: string;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'date must be in YYYY-MM-DD format' })
  date: string;

  @IsBoolean()
  @IsOptional()
  isRecurringYearly?: boolean;
}

export class UpdateHolidayDto {
  @IsUUID()
  @IsNotEmpty()
  id: string;

  @IsUUID()
  @IsNotEmpty()
  workspaceId: string;

  @IsUUID()
  @IsNotEmpty()
  requestorId: string;

  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'date must be in YYYY-MM-DD format' })
  date?: string;

  @IsBoolean()
  @IsOptional()
  isRecurringYearly?: boolean;
}

export class DeleteHolidayDto {
  @IsUUID()
  @IsNotEmpty()
  id: string;

  @IsUUID()
  @IsNotEmpty()
  workspaceId: string;

  @IsUUID()
  @IsNotEmpty()
  requestorId: string;
}

export class AutoFillHolidaysDto {
  @IsUUID()
  @IsNotEmpty()
  workspaceId: string;

  @IsUUID()
  @IsNotEmpty()
  requestorId: string;

  @IsNumber()
  @IsNotEmpty()
  year: number;

  @IsString()
  @IsNotEmpty()
  countryCode: string;
}

export class SaveFaceBaselineDto {
  @IsUUID()
  @IsNotEmpty()
  workspaceId: string;

  @IsUUID()
  @IsNotEmpty()
  userId: string;

  @IsString()
  @IsOptional()
  faceImageKey?: string;

  @IsArray()
  @IsNumber({}, { each: true })
  @IsNotEmpty()
  faceDescriptor: number[];
}

