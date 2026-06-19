import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DatabaseModule } from '@slack/database';
import { CalendarController } from './calendar.controller';
import { CalendarService } from './calendar.service';
import { WorkShiftService } from './services/work-shift.service';
import { WorkspaceCalendarPolicyEntity } from './entity/workspace_calendar_policy.entity';
import { WorkShiftEntity } from './entity/work_shift.entity';
import { CalendarRequestEntity } from './entity/calendar_request.entity';
import { LeaveBalanceEntity } from './entity/leave_balance.entity';
import { AttendanceLogEntity } from './entity/attendance_log.entity';
import { DailyReconciliationEntity } from './entity/daily_reconciliation.entity';
import { UserFaceBaselineEntity } from './entity/user_face_baseline.entity';
import { ClientsModule } from '@nestjs/microservices';
import { NAME_SERVICE_TCP, PORT_TCP } from '@slack/constants';
import { getMicroserviceClientConfig } from '@slack/common';

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
    ClientsModule.registerAsync([
      getMicroserviceClientConfig(NAME_SERVICE_TCP.WORKSPACE_SERVICE, PORT_TCP.WORKSPACE_TCP_PORT),
    ]),
  ],
  controllers: [CalendarController],
  providers: [CalendarService, WorkShiftService],
})
export class CalendarModule {}
