import {
  Column,
  Entity,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import {
  CalendarRequestType,
  CalendarRequestStatus,
} from '../types/calendar.enum';

@Entity('calendar_requests')
// Composite index phục vụ getRequests với filter status + sort createdAt
@Index('IDX_CALENDAR_REQ_WS_USER_STATUS', [
  'workspaceId',
  'userId',
  'status',
  'createdAt',
])
@Index('IDX_CALENDAR_REQ_WS_STATUS_CREATED', [
  'workspaceId',
  'status',
  'createdAt',
])
@Index('IDX_CALENDAR_REQ_WS_USER_CREATED', [
  'workspaceId',
  'userId',
  'createdAt',
])
// Composite index phục vụ checkOverlappingRequest (range query trên startTime/endTime)
@Index('IDX_CALENDAR_REQ_WS_USER_TIME', [
  'workspaceId',
  'userId',
  'startTime',
  'endTime',
])
export class CalendarRequestEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'uuid' })
  @Index()
  userId: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  @Index()
  workspaceId: string;

  @Column({
    name: 'request_type',
    type: 'enum',
    enumName: 'calendar_request_type_enum',
    enum: CalendarRequestType,
  })
  requestType: CalendarRequestType;

  @Column({ name: 'start_time', type: 'timestamptz' })
  startTime: Date;

  @Column({ name: 'end_time', type: 'timestamptz' })
  endTime: Date;

  @Column({ name: 'duration_days', type: 'float', default: 1.0 })
  durationDays: number;

  @Column({ type: 'text' })
  reason: string;

  @Column({
    type: 'enum',
    enumName: 'calendar_request_status_enum',
    enum: CalendarRequestStatus,
    default: CalendarRequestStatus.PENDING,
  })
  status: CalendarRequestStatus;

  @Column({ name: 'approved_by', type: 'uuid', nullable: true })
  approvedBy: string;

  @Column({ name: 'reject_reason', type: 'text', nullable: true })
  rejectReason: string; // Manager ghi lý do từ chối

  @Column({ type: 'text', nullable: true })
  notes: string; // Ghi chú bổ sung từ nhân viên hoặc manager

  @Column({ name: 'meta_data', type: 'jsonb', nullable: true })
  metaData: Record<string, any>;
  /*
    Dùng cho đơn ATTENDANCE_CORRECTION:
    {
      "correctionDate": "2026-06-15",
      "requestedCheckIn": "2026-06-15T08:00:00Z",
      "requestedCheckOut": "2026-06-15T17:00:00Z"
    }
    Dùng cho đơn CALENDAR_OPEN_REQUEST:
    {
      "targetYear": 2026,
      "targetMonth": 7
    }
  */

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;
}
