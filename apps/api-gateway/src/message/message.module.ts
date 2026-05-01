import { Module } from '@nestjs/common';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { NAME_SERVICE_TCP, PORT_TCP } from '@slack/constants';
import { MessageController } from './message.controller';
import { ThreadController } from './thread.controller';
import { MessageService } from './message.service';

@Module({
  imports: [
    ClientsModule.register([
      {
        name: NAME_SERVICE_TCP.MESSAGE_SERVICE,
        transport: Transport.TCP,
        options: {
          host: 'localhost',
          port: PORT_TCP.MESSAGE_TCP_PORT,
        },
      },
    ]),
  ],
  controllers: [MessageController, ThreadController],
  providers: [MessageService],
})
export class MessageModule {}
