export enum ShiftLocation {
  OFFICE = 'OFFICE',
  WFH = 'WFH',
}

export enum ShiftStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
}

export enum CalendarRequestType {
  LEAVE_PAID = 'LEAVE_PAID',
  LEAVE_UNPAID = 'LEAVE_UNPAID',
  LEAVE_SICK = 'LEAVE_SICK',
  OFF_SHIFT = 'OFF_SHIFT',
  CALENDAR_OPEN_REQUEST = 'CALENDAR_OPEN_REQUEST',
  ATTENDANCE_CORRECTION = 'ATTENDANCE_CORRECTION',
}

export enum CalendarRequestStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  CANCELLED = 'CANCELLED',
}

export enum CalendarRequestAction {
  APPROVE = 'APPROVE',
  REJECT = 'REJECT',
}

export enum AttendanceLogType {
  CHECK_IN = 'CHECK_IN',
  CHECK_OUT = 'CHECK_OUT',
}

export enum InOutStatus {
  IN = 'IN',
  OUT = 'OUT',
  NOT_STARTED = 'NOT_STARTED',
}

export enum DailyReconciliationStatus {
  NORMAL = 'NORMAL',
  LATE_EARLY = 'LATE_EARLY',
  ABSENT = 'ABSENT',
  LEAVE_PAID_APPROVED = 'LEAVE_PAID_APPROVED',
  LEAVE_UNPAID_APPROVED = 'LEAVE_UNPAID_APPROVED',
}
