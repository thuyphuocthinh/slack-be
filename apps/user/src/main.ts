import { NestFactory } from '@nestjs/core';
import { UserModule } from './user.module';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { AllRpcExceptionFilter } from '@slack/common';

import { ValidationPipe } from '@nestjs/common';
import { PORT_TCP } from '@slack/constants';

async function bootstrap() {
  const app = await NestFactory.createMicroservice<MicroserviceOptions>(
    UserModule,
    {
      transport: Transport.TCP,
      options: {
        host: 'localhost',
        port: PORT_TCP.USER_TCP_PORT,
      },
    },
  );

  app.useGlobalFilters(new AllRpcExceptionFilter());
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: false, // Allow extra properties for microservice flexibility
    }),
  );
  await app.listen();
}
bootstrap();
