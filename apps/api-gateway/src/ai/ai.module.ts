import { Module } from '@nestjs/common';
import { ClientsModule } from '@nestjs/microservices';
import { NAME_SERVICE_TCP, PORT_TCP } from '@slack/constants';
import { getMicroserviceClientConfig } from '@slack/common';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';

@Module({
  imports: [
    ClientsModule.registerAsync([
      getMicroserviceClientConfig(NAME_SERVICE_TCP.INTEGRATIONS_SERVICE, PORT_TCP.INTEGRATIONS_TCP_PORT),
    ]),
  ],
  controllers: [AiController],
  providers: [AiService],
})
export class AiModule {}
