import { Module } from '@nestjs/common';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { NAME_SERVICE_TCP, PORT_TCP } from '@slack/constants';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';

@Module({
  imports: [
    ClientsModule.register([
      {
        name: NAME_SERVICE_TCP.INTEGRATIONS_SERVICE,
        transport: Transport.TCP,
        options: {
          host: 'localhost',
          port: PORT_TCP.INTEGRATIONS_TCP_PORT,
        },
      },
    ]),
  ],
  controllers: [AiController],
  providers: [AiService],
})
export class AiModule {}
