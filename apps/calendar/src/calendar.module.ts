import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DatabaseModule } from '@slack/database';
import { CalendarController } from './calendar.controller';
import { CalendarService } from './calendar.service';
import { WorkspaceCalendarPolicyEntity } from './entity/workspace_calendar_policy.entity';
import { WorkShiftEntity } from './entity/work_shift.entity';
import { CalendarRequestEntity } from './entity/calendar_request.entity';
import { LeaveBalanceEntity } from './entity/leave_balance.entity';
import { AttendanceLogEntity } from './entity/attendance_log.entity';
import { DailyReconciliationEntity } from './entity/daily_reconciliation.entity';
import { UserFaceBaselineEntity } from './entity/user_face_baseline.entity';

@Module({
  imports: [
    DatabaseModule,
    TypeOrmModule.forFeature([
      WorkspaceCalendarPolicyEntity,
      WorkShiftEntity,
      CalendarRequestEntity,
      LeaveBalanceEntity,
      AttendanceLogEntity,
      DailyReconciliationEntity,
      UserFaceBaselineEntity,
    ]),
  ],
  controllers: [CalendarController],
  providers: [CalendarService],
})
export class CalendarModule {}
