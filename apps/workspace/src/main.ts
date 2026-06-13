import { NestFactory } from '@nestjs/core';
import { WinstonModule } from 'nest-winston';
import { getLoggerConfig } from '@slack/common';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { AllRpcExceptionFilter } from '@slack/common';

import { ValidationPipe } from '@nestjs/common';
import { PORT_TCP } from '@slack/constants';
import { WorkspaceModule } from './workspace.module';

async function bootstrap() {
  const app = await NestFactory.createMicroservice<MicroserviceOptions>(
    WorkspaceModule,
    {
      transport: Transport.TCP,
      options: {
        host: process.env.WORKSPACE_SERVICE_HOST || '0.0.0.0',
        port: process.env.WORKSPACE_SERVICE_PORT ? parseInt(process.env.WORKSPACE_SERVICE_PORT) : PORT_TCP.WORKSPACE_TCP_PORT,
      },
      logger: WinstonModule.createLogger(getLoggerConfig('WORKSPACE')),
    },
  );
  app.enableShutdownHooks();

  app.useGlobalFilters(new AllRpcExceptionFilter());
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: false,
      forbidNonWhitelisted: false, // Allow extra properties for microservice flexibility
    }),
  );
  await app.listen();
}
bootstrap();
