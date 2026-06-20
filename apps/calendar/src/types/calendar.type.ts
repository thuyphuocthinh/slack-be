import { ShiftLocation } from './calendar.enum';

export interface WorkShiftValidationPayload {
  id?: string;
  workDate: string;
  startTime: Date;
  endTime: Date;
  location: ShiftLocation;
}
