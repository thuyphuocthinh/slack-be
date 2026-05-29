import { Module } from '@nestjs/common';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { NAME_SERVICE_TCP, PORT_TCP } from '@slack/constants';
import { QueueModule, EQueueName } from '@slack/queue';
import { WebhookReceiverController } from './webhook-receiver.controller';
import { CommandReceiverController } from './command-receiver.controller';
import { ViewsController } from './views.controller';
import { WebhookReceiverService } from './webhook-receiver.service';

@Module({
  imports: [
    QueueModule.forRoot(),
    QueueModule.forFeature([EQueueName.MESSAGE_QUEUE]),
    ClientsModule.register([
      {
        name: NAME_SERVICE_TCP.CHANNEL_SERVICE,
        transport: Transport.TCP,
        options: {
          host: 'localhost',
          port: PORT_TCP.CHANNEL_TCP_PORT,
        },
      },
      {
        name: NAME_SERVICE_TCP.WORKSPACE_SERVICE,
        transport: Transport.TCP,
        options: {
          host: 'localhost',
          port: PORT_TCP.WORKSPACE_TCP_PORT,
        },
      },
    ]),
  ],
  controllers: [WebhookReceiverController, CommandReceiverController, ViewsController],
  providers: [WebhookReceiverService],
})
export class WebhookReceiverModule {}
