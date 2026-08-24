import { Module } from '@nestjs/common';
import { ClientsModule } from '@nestjs/microservices';
import { NAME_SERVICE_TCP, PORT_TCP } from '@slack/constants';
import { getMicroserviceClientConfig } from '@slack/common';
import { OrchestrationController } from './orchestration.controller';
import { OrchestrationService } from './orchestration.service';

@Module({
  imports: [
    ClientsModule.registerAsync([
      getMicroserviceClientConfig(NAME_SERVICE_TCP.ORCHESTRATION_SERVICE, PORT_TCP.ORCHESTRATION_TCP_PORT),
    ]),
  ],
  controllers: [OrchestrationController],
  providers: [OrchestrationService],
})
export class OrchestrationGatewayModule {}
