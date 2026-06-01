import { NestFactory } from '@nestjs/core';
import { WinstonModule } from 'nest-winston';
import { getLoggerConfig } from '@slack/common';
import { IntegrationsModule } from './integrations.module';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { AllRpcExceptionFilter } from '@slack/common';

import { ValidationPipe } from '@nestjs/common';
import { PORT_TCP } from '@slack/constants';

async function bootstrap() {
  const app = await NestFactory.createMicroservice<MicroserviceOptions>(
    IntegrationsModule,
    {
      transport: Transport.TCP,
      options: {
        host: 'localhost',
        port: PORT_TCP.INTEGRATIONS_TCP_PORT,
      },
      logger: WinstonModule.createLogger(getLoggerConfig('INTEGRATIONS')),
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
