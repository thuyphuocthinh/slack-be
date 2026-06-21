import { Exclude, Expose, Type } from 'class-transformer';
import { ShiftLocation, ShiftStatus, CalendarRequestType, CalendarRequestStatus } from '../types/calendar.enum';

@Exclude()
export class WorkShiftResponseDto {
  @Expose()
  id: string;

  @Expose()
  userId: string;

  @Expose()
  workspaceId: string;

  @Expose()
  workDate: string;

  @Expose()
  location: ShiftLocation;

  @Expose()
  startTime: Date;

  @Expose()
  endTime: Date;

  @Expose()
  status: ShiftStatus;

  @Expose()
  createdAt: Date;

  @Expose()
  updatedAt: Date;

  @Expose()
  notes?: string;

  @Expose()
  @Type(() => AttendanceLogResponseDto)
  attendanceLogs?: AttendanceLogResponseDto[];

  @Expose()
  inOutStatus?: string;
}

@Exclude()
export class AttendanceLogResponseDto {
  @Expose()
  id: string;

  @Expose()
  userId: string;

  @Expose()
  logType: string;

  @Expose()
  recordedAt: Date;
}

@Exclude()
export class PolicyDataResponseDto {
  @Expose()
  maxWfhDaysPerWeek?: number;

  @Expose()
  maxFullTimeHours?: number;

  @Expose()
  maxPartTimeHours?: number;

  @Expose()
  lockDeadlineDay?: number;

  @Expose()
  maxPaidLeaveDaysPerYear?: number;
}

@Exclude()
export class WorkspaceCalendarPolicyResponseDto {
  @Expose()
  id: string;

  @Expose()
  workspaceId: string;

  @Expose()
  @Type(() => PolicyDataResponseDto)
  policyData: PolicyDataResponseDto;

  @Expose()
  createdAt: Date;

  @Expose()
  updatedAt: Date;
}

@Exclude()
export class CalendarRequestResponseDto {
  @Expose()
  id: string;

  @Expose()
  userId: string;

  @Expose()
  workspaceId: string;

  @Expose()
  requestType: CalendarRequestType;

  @Expose()
  startTime: Date;

  @Expose()
  endTime: Date;

  @Expose()
  durationDays: number;

  @Expose()
  reason: string;

  @Expose()
  status: CalendarRequestStatus;

  @Expose()
  approvedBy?: string;

  @Expose()
  rejectReason?: string;

  @Expose()
  notes?: string;

  @Expose()
  metaData?: Record<string, any>;

  @Expose()
  createdAt: Date;

  @Expose()
  updatedAt: Date;
}

@Exclude()
export class LeaveBalanceResponseDto {
  @Expose()
  id: string;

  @Expose()
  userId: string;

  @Expose()
  workspaceId: string;

  @Expose()
  year: number;

  @Expose()
  totalPaidLeave: number;

  @Expose()
  usedPaidLeave: number;

  @Expose()
  createdAt: Date;

  @Expose()
  updatedAt: Date;
}
