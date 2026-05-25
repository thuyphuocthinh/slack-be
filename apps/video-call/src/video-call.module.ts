import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { DatabaseModule } from '@slack/database';
import { QueueModule, EQueueName } from '@slack/queue';
import { NAME_SERVICE_TCP, PORT_TCP } from '@slack/constants';
import { VideoCallController } from './video-call.controller';
import { VideoCallService } from './video-call.service';
import { HuddleEntity } from './entity/huddle.entity';
import { HuddleParticipantEntity } from './entity/huddle-participant.entity';

@Module({
  imports: [
    DatabaseModule,
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    TypeOrmModule.forFeature([HuddleEntity, HuddleParticipantEntity]),
    QueueModule.forRoot(),
    QueueModule.forFeature([EQueueName.SOCKET_QUEUE]),
    ClientsModule.register([
      {
        name: NAME_SERVICE_TCP.CHANNEL_SERVICE,
        transport: Transport.TCP,
        options: {
          host: 'localhost',
          port: PORT_TCP.CHANNEL_TCP_PORT,
        },
      },
    ]),
  ],
  controllers: [VideoCallController],
  providers: [VideoCallService],
  exports: [VideoCallService],
})
export class VideoCallModule {}
