import { NestFactory } from '@nestjs/core';
import { WinstonModule } from 'nest-winston';
import { getLoggerConfig } from '@slack/common';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { PORT_TCP } from '@slack/constants';
import * as dotenv from 'dotenv';
import { ValidationPipe } from '@nestjs/common';
import { AllRpcExceptionFilter } from '@slack/common';
import { MessageModule } from './message.module';

async function bootstrap() {
  dotenv.config();
  const app = await NestFactory.createMicroservice<MicroserviceOptions>(
    MessageModule,
    {
      transport: Transport.TCP,
      options: {
        host: process.env.MESSAGE_SERVICE_HOST || '0.0.0.0',
        port: process.env.MESSAGE_SERVICE_PORT ? parseInt(process.env.MESSAGE_SERVICE_PORT) : PORT_TCP.MESSAGE_TCP_PORT,
      },
      logger: WinstonModule.createLogger(getLoggerConfig('MESSAGE')),
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
