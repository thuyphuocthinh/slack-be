import { NestFactory } from '@nestjs/core';
import { WinstonModule } from 'nest-winston';
import { getLoggerConfig } from '@slack/common';
import { NoteModule } from './note.module';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { ValidationPipe } from '@nestjs/common';
import { AllRpcExceptionFilter } from '@slack/common';
import { PORT_TCP } from '@slack/constants';
import * as dns from 'dns';

dns.setDefaultResultOrder('ipv4first');

async function bootstrap() {
  const app = await NestFactory.createMicroservice<MicroserviceOptions>(
    NoteModule,
    {
      transport: Transport.TCP,
      options: {
        host: process.env.NOTE_SERVICE_HOST || '0.0.0.0',
        port: process.env.NOTE_SERVICE_PORT
          ? parseInt(process.env.NOTE_SERVICE_PORT)
          : PORT_TCP.NOTE_TCP_PORT,
      },
      logger: WinstonModule.createLogger(getLoggerConfig('NOTE')),
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
