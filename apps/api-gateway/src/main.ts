import { NestFactory } from '@nestjs/core';
import { ApiGatewayModule } from './api-gateway.module';
import * as dotenv from 'dotenv';
import { ValidationPipe } from '@nestjs/common';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';

async function bootstrap() {
  dotenv.config();
  const app = await NestFactory.create(ApiGatewayModule);
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );
  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalInterceptors(new ResponseInterceptor());
  app.enableCors();
  app.setGlobalPrefix('api');
  const port = process.env.GATEWAY_PORT || 3000;
  await app.listen(port);
  console.log(`Gateway listening on http://localhost:${port}`);
}
bootstrap();
