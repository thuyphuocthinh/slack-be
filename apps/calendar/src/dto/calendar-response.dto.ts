import { Exclude, Expose } from 'class-transformer';
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
