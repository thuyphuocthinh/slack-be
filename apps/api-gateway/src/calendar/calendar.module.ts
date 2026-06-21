import { Module } from '@nestjs/common';
import { ClientsModule } from '@nestjs/microservices';
import { NAME_SERVICE_TCP, PORT_TCP } from '@slack/constants';
import { getMicroserviceClientConfig } from '@slack/common';
import { CalendarController } from './calendar.controller';
import { CalendarService } from './calendar.service';
import { v2 as cloudinary } from 'cloudinary';

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
  providers: [
    CalendarService,
    {
      provide: 'CLOUDINARY',
      useFactory: () => {
        cloudinary.config({
          cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
          api_key: process.env.CLOUDINARY_API_KEY,
          api_secret: process.env.CLOUDINARY_API_SECRET,
        });
        return cloudinary;
      },
    },
  ],
})
export class CalendarModule {}
