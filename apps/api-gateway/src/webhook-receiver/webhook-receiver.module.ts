import { Module } from '@nestjs/common';
import { ClientsModule } from '@nestjs/microservices';
import { NAME_SERVICE_TCP, PORT_TCP } from '@slack/constants';
import { getMicroserviceClientConfig } from '@slack/common';
import { QueueModule, EQueueName } from '@slack/queue';
import { WebhookReceiverController } from './webhook-receiver.controller';
import { CommandReceiverController } from './command-receiver.controller';
import { ViewsController } from './views.controller';
import { WebhookReceiverService } from './webhook-receiver.service';

@Module({
  imports: [
    QueueModule.forRoot(),
    QueueModule.forFeature([EQueueName.MESSAGE_QUEUE, EQueueName.SOCKET_QUEUE]),
    ClientsModule.registerAsync([
      getMicroserviceClientConfig(NAME_SERVICE_TCP.CHANNEL_SERVICE, PORT_TCP.CHANNEL_TCP_PORT),
      getMicroserviceClientConfig(NAME_SERVICE_TCP.WORKSPACE_SERVICE, PORT_TCP.WORKSPACE_TCP_PORT),
      getMicroserviceClientConfig(NAME_SERVICE_TCP.INTEGRATIONS_SERVICE, PORT_TCP.INTEGRATIONS_TCP_PORT),
    ]),
  ],
  controllers: [WebhookReceiverController, CommandReceiverController, ViewsController],
  providers: [WebhookReceiverService],
})
export class WebhookReceiverModule {}
