import { Module } from '@nestjs/common';
import { ClientsModule } from '@nestjs/microservices';
import { NAME_SERVICE_TCP, PORT_TCP } from '@slack/constants';
import { getMicroserviceClientConfig } from '@slack/common';
import { AiProvidersController } from './ai-providers.controller';
import { AiProvidersService } from './ai-providers.service';

@Module({
  imports: [
    ClientsModule.registerAsync([
      getMicroserviceClientConfig(
        NAME_SERVICE_TCP.ORCHESTRATION_SERVICE,
        PORT_TCP.ORCHESTRATION_TCP_PORT,
      ),
    ]),
  ],
  controllers: [AiProvidersController],
  providers: [AiProvidersService],
})
export class AiProvidersModule {}
