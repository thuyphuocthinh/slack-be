import { Module } from '@nestjs/common';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { NAME_SERVICE_TCP, PORT_TCP } from '@slack/constants';
import { QueueModule, EQueueName } from '@slack/queue';
import { WebhookReceiverController } from './webhook-receiver.controller';

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
    ]),
  ],
  controllers: [WebhookReceiverController],
})
export class WebhookReceiverModule {}
