import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { ValidationPipe } from '@nestjs/common';
import { WinstonModule } from 'nest-winston';
import { getLoggerConfig } from '@slack/common';
import { AllRpcExceptionFilter } from '@slack/common';
import { PORT_TCP } from '@slack/constants';
import { BillingModule } from './billing.module';

async function bootstrap() {
  const app = await NestFactory.createMicroservice<MicroserviceOptions>(
    BillingModule,
    {
      transport: Transport.TCP,
      options: {
        host: 'localhost',
        port: PORT_TCP.BILLING_TCP_PORT,
      },
      logger: WinstonModule.createLogger(getLoggerConfig('BILLING')),
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
