import { NestFactory } from '@nestjs/core';
import { SocketGatewayModule } from './socket-gateway.module';
import { RedisIoAdapter } from './adapters/redis-io.adapter';
import { ConfigService } from '@nestjs/config';
import { WinstonModule } from 'nest-winston';
import { getLoggerConfig } from '@slack/common';

async function bootstrap() {
  const app = await NestFactory.create(SocketGatewayModule, {
    logger: WinstonModule.createLogger(getLoggerConfig('SOCKET_GATEWAY')),
  });

  const configService = app.get(ConfigService);
  const redisIoAdapter = new RedisIoAdapter(app, configService);
  await redisIoAdapter.connectToRedis();
  app.useWebSocketAdapter(redisIoAdapter);

  const port = configService.get<number>('SOCKET_PORT', 3008);
  await app.listen(port);
  console.log(`Socket Gateway is running on: http://localhost:${port}`);
}
bootstrap();
