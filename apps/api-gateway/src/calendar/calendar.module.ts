import { Module } from '@nestjs/common';
import { createMicroserviceClient } from '@slack/common';
import { NAME_SERVICE_TCP, PORT_TCP } from '@slack/constants';
import { CalendarController } from './calendar.controller';
import { CalendarService } from './calendar.service';

@Module({
  controllers: [CalendarController],
  providers: [
    CalendarService,
    createMicroserviceClient(
      NAME_SERVICE_TCP.CALENDAR_SERVICE,
      PORT_TCP.CALENDAR_TCP_PORT,
    ),
  ],
})
export class CalendarModule {}
