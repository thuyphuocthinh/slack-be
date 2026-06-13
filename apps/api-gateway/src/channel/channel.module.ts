import { Module } from '@nestjs/common';
import { ClientsModule } from '@nestjs/microservices';
import { NAME_SERVICE_TCP, PORT_TCP } from '@slack/constants';
import { getMicroserviceClientConfig } from '@slack/common';
import { ChannelController } from './channel.controller';
import { ChannelService } from './channel.service';

@Module({
  imports: [
    ClientsModule.registerAsync([
      getMicroserviceClientConfig(NAME_SERVICE_TCP.CHANNEL_SERVICE, PORT_TCP.CHANNEL_TCP_PORT),
    ]),
  ],
  controllers: [ChannelController],
  providers: [ChannelService],
  exports: [ChannelService],
})
export class ChannelModule {}
