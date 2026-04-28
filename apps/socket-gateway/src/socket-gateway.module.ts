import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { SocketGateway } from './gateway/socket.gateway';
import { SocketService } from './services/socket.service';
import { Redis } from 'ioredis';
import { QueueModule, EQueueName } from '@slack/queue';
import { SocketProcessor } from './processors/socket.processor';
import { JwtModule } from '@nestjs/jwt';
import { CachedModule } from '@slack/cached';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    QueueModule.forRoot(),
    QueueModule.forFeature([EQueueName.SOCKET_QUEUE]),
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'fallback_secret',
    }),
    CachedModule.forRoot(),
  ],
  providers: [
    SocketGateway,
    SocketService,
    SocketProcessor,
    {
      provide: 'REDIS_SUBSCRIBER',
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        return new Redis({
          host: configService.get<string>('REDIS_HOST', '127.0.0.1'),
          port: configService.get<number>('REDIS_PORT', 6379),
          password: configService.get<string>('REDIS_PASSWORD'),
        });
      },
    },
    {
      provide: 'REDIS_PUBLISHER',
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        return new Redis({
          host: configService.get<string>('REDIS_HOST', '127.0.0.1'),
          port: configService.get<number>('REDIS_PORT', 6379),
          password: configService.get<string>('REDIS_PASSWORD'),
        });
      },
    },
  ],
})
export class SocketGatewayModule {}
