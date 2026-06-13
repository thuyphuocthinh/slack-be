import { Module } from '@nestjs/common';
import { ClientsModule } from '@nestjs/microservices';
import { NAME_SERVICE_TCP, PORT_TCP } from '@slack/constants';
import { getMicroserviceClientConfig } from '@slack/common';
import { MessageController } from './message.controller';
import { ThreadController } from './thread.controller';
import { MessageService } from './message.service';
import { BillingModule } from '../billing/billing.module';

@Module({
  imports: [
    BillingModule,
    ClientsModule.registerAsync([
      getMicroserviceClientConfig(NAME_SERVICE_TCP.MESSAGE_SERVICE, PORT_TCP.MESSAGE_TCP_PORT),
    ]),
  ],
  controllers: [MessageController, ThreadController],
  providers: [MessageService],
})
export class MessageModule {}
