import { Module } from '@nestjs/common';
import { ClientsModule } from '@nestjs/microservices';
import { getMicroserviceClientConfig } from '@slack/common';
import { NAME_SERVICE_TCP, PORT_TCP } from '@slack/constants';
import { IntegrationsController } from './integrations.controller';
import { IntegrationsCallbackController } from './integrations-callback.controller';
import { IntegrationsService } from './integrations.service';

@Module({
  imports: [
    ClientsModule.registerAsync([
      getMicroserviceClientConfig(NAME_SERVICE_TCP.INTEGRATIONS_SERVICE, PORT_TCP.INTEGRATIONS_TCP_PORT),
    ]),
  ],
  controllers: [IntegrationsController, IntegrationsCallbackController],
  providers: [IntegrationsService],
})
export class IntegrationsModule {}
