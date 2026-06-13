import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { SocketGateway } from './gateway/socket.gateway';
import { QueueModule, EQueueName } from '@slack/queue';
import { SocketProcessor } from './processors/socket.processor';
import { JwtModule } from '@nestjs/jwt';
import { CachedModule } from '@slack/cached';
import { ClientsModule } from '@nestjs/microservices';
import { NAME_SERVICE_TCP, PORT_TCP } from '@slack/constants';
import { getMicroserviceClientConfig } from '@slack/common';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    QueueModule.forRoot(),
    QueueModule.forFeature([EQueueName.SOCKET_QUEUE]),
    ClientsModule.registerAsync([
      getMicroserviceClientConfig(NAME_SERVICE_TCP.CHANNEL_SERVICE, PORT_TCP.CHANNEL_TCP_PORT),
      getMicroserviceClientConfig(NAME_SERVICE_TCP.MESSAGE_SERVICE, PORT_TCP.MESSAGE_TCP_PORT),
    ]),
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get('JWT_SECRET'),
      }),
    }),
    CachedModule.forRoot(),
  ],
  providers: [SocketGateway, SocketProcessor],
})
export class SocketGatewayModule {}
