import { NestFactory } from '@nestjs/core';
import { WinstonModule } from 'nest-winston';
import { getLoggerConfig } from '@slack/common';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { PORT_TCP } from '@slack/constants';
import * as dotenv from 'dotenv';
import { ValidationPipe } from '@nestjs/common';
import { AllRpcExceptionFilter } from '@slack/common';
import { ChannelModule } from './channel.module';

async function bootstrap() {
  dotenv.config();
  const app = await NestFactory.createMicroservice<MicroserviceOptions>(
    ChannelModule,
    {
      transport: Transport.TCP,
      options: {
        host: process.env.CHANNEL_SERVICE_HOST || '0.0.0.0',
        port: process.env.CHANNEL_SERVICE_PORT ? parseInt(process.env.CHANNEL_SERVICE_PORT) : PORT_TCP.CHANNEL_TCP_PORT,
      },
      logger: WinstonModule.createLogger(getLoggerConfig('CHANNEL')),
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
