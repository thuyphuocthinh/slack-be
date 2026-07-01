import { NestFactory } from '@nestjs/core';
import { WinstonModule } from 'nest-winston';
import { getLoggerConfig } from '@slack/common';
import { OrchestrationModule } from './orchestration.module';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { ValidationPipe } from '@nestjs/common';
import { AllRpcExceptionFilter } from '@slack/common';
import { PORT_TCP } from '@slack/constants';
import * as dns from 'dns';

dns.setDefaultResultOrder('ipv4first');

async function bootstrap() {
  const app = await NestFactory.createMicroservice<MicroserviceOptions>(
    OrchestrationModule,
    {
      transport: Transport.TCP,
      options: {
        host: process.env.ORCHESTRATION_SERVICE_HOST || '0.0.0.0',
        port: process.env.ORCHESTRATION_SERVICE_PORT
          ? parseInt(process.env.ORCHESTRATION_SERVICE_PORT)
          : PORT_TCP.ORCHESTRATION_TCP_PORT,
      },
      logger: WinstonModule.createLogger(getLoggerConfig('ORCHESTRATION')),
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
