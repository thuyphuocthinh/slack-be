import { NestFactory } from '@nestjs/core';
import { WinstonModule } from 'nest-winston';
import { getLoggerConfig } from '@slack/common';
import { AuthModule } from './auth.module';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { PORT_TCP } from '@slack/constants';
import * as dotenv from 'dotenv';
import { ValidationPipe } from '@nestjs/common';
import { AllRpcExceptionFilter } from '@slack/common';

async function bootstrap() {
  dotenv.config();
  const app = await NestFactory.createMicroservice<MicroserviceOptions>(
    AuthModule,
    {
      transport: Transport.TCP,
      options: {
        host: 'localhost',
        port: PORT_TCP.AUTH_TCP_PORT,
      },
      logger: WinstonModule.createLogger(getLoggerConfig('AUTH')),
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
