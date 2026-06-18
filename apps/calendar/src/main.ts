import { NestFactory } from '@nestjs/core';
import { WinstonModule } from 'nest-winston';
import { getLoggerConfig } from '@slack/common';
import { CalendarModule } from './calendar.module';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { PORT_TCP } from '@slack/constants';
import * as dotenv from 'dotenv';
import { ValidationPipe } from '@nestjs/common';
import { AllRpcExceptionFilter } from '@slack/common';

async function bootstrap() {
  dotenv.config();
  const app = await NestFactory.createMicroservice<MicroserviceOptions>(
    CalendarModule,
    {
      transport: Transport.TCP,
      options: {
        host: process.env.CALENDAR_SERVICE_HOST || '0.0.0.0',
        port: process.env.CALENDAR_SERVICE_PORT ? parseInt(process.env.CALENDAR_SERVICE_PORT) : PORT_TCP.CALENDAR_TCP_PORT,
      },
      logger: WinstonModule.createLogger(getLoggerConfig('CALENDAR')),
    },
  );
  app.enableShutdownHooks();
  app.useGlobalFilters(new AllRpcExceptionFilter());
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: false,
      forbidNonWhitelisted: false,
    }),
  );
  await app.listen();
}
bootstrap();
