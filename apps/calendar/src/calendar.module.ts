import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
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
import { CalendarUserLockEntity } from './entity/calendar_user_lock.entity';
import { ClientsModule } from '@nestjs/microservices';
import { NAME_SERVICE_TCP, PORT_TCP } from '@slack/constants';
import { getMicroserviceClientConfig } from '@slack/common';
import { WorkspaceCalendarPolicyService } from './services/workspace-calendar-policy.service';
import { CalendarRequestService } from './services/calendar-request.service';
import { CalendarCommonService } from './services/calendar-common.service';
import { AttendanceService } from './services/attendance.service';
import { CalendarCronService } from './services/calendar-cron.service';
import { LeaveBalanceService } from './services/leave-balance.service';

import { CachedModule } from '@slack/cached';
import { QueueModule, EQueueName } from '@slack/queue';

import { CalendarProcessor } from './processors/calendar.processor';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    CachedModule.forRoot(),
    DatabaseModule,
    TypeOrmModule.forFeature([
      WorkspaceCalendarPolicyEntity,
      WorkShiftEntity,
      CalendarRequestEntity,
      LeaveBalanceEntity,
      AttendanceLogEntity,
      DailyReconciliationEntity,
      UserFaceBaselineEntity,
      CalendarUserLockEntity,
    ]),
    QueueModule.forRoot(),
    QueueModule.forFeature([EQueueName.CALENDAR_QUEUE]),
    ClientsModule.registerAsync([
      getMicroserviceClientConfig(NAME_SERVICE_TCP.WORKSPACE_SERVICE, PORT_TCP.WORKSPACE_TCP_PORT),
      getMicroserviceClientConfig(NAME_SERVICE_TCP.NOTIFICATION_SERVICE, PORT_TCP.NOTIFICATION_TCP_PORT),
    ]),
  ],
  controllers: [CalendarController],
  providers: [
    CalendarService,
    CalendarCommonService,
    WorkShiftService,
    WorkspaceCalendarPolicyService,
    CalendarRequestService,
    AttendanceService,
    CalendarCronService,
    LeaveBalanceService,
    CalendarProcessor,
  ],
})
export class CalendarModule {}
