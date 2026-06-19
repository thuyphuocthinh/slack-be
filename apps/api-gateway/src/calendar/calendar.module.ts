import { Module } from '@nestjs/common';
import { ClientsModule } from '@nestjs/microservices';
import { NAME_SERVICE_TCP, PORT_TCP } from '@slack/constants';
import { getMicroserviceClientConfig } from '@slack/common';
import { CalendarController } from './calendar.controller';
import { CalendarService } from './calendar.service';

@Module({
  imports: [
    ClientsModule.registerAsync([
      getMicroserviceClientConfig(
        NAME_SERVICE_TCP.CALENDAR_SERVICE,
        PORT_TCP.CALENDAR_TCP_PORT,
      ),
    ]),
  ],
  controllers: [CalendarController],
  providers: [CalendarService],
})
export class CalendarModule {}
