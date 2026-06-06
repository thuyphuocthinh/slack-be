import { Module } from '@nestjs/common';
import { CanvasController } from './canvas.controller';
import { CanvasService } from './canvas.service';
import { DatabaseModule } from '@slack/database';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CanvasEntity } from './entity/canvas.entity';
import { CachedModule } from '@slack/cached';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { NAME_SERVICE_TCP, PORT_TCP } from '@slack/constants';
import { HocuspocusGateway } from './hocuspocus/hocuspocus.gateway';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';

@Module({
  imports: [
    DatabaseModule,
    CachedModule.forRoot(),
    TypeOrmModule.forFeature([CanvasEntity]),
    JwtModule.register({}),
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
  controllers: [CanvasController],
  providers: [CanvasService, HocuspocusGateway],
})
export class CanvasModule {}
