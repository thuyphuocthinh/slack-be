import { Exclude, Expose, Type } from 'class-transformer';
import { ShiftLocation, ShiftStatus } from '../types/calendar.enum';

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
