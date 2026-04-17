import { Module } from '@nestjs/common';
import { UserController } from './user.controller';
import { UserService } from './services/user.service';
import { DatabaseModule } from '@slack/database';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserEntity } from './entity/user.entity';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { NAME_SERVICE_TCP } from '@slack/constants';
import { TwoFactorEntity } from './entity/two_factor.entity';
import { TwoFactorService } from './services/two_fa.service';

@Module({
  imports: [
    DatabaseModule,
    TypeOrmModule.forFeature([UserEntity, TwoFactorEntity]),
    ClientsModule.register([
      {
        name: NAME_SERVICE_TCP.AUTH_SERVICE,
        transport: Transport.TCP,
        options: {
          host: 'localhost',
          port: 3001,
        },
      },
    ]),
  ],
  controllers: [UserController],
  providers: [UserService, TwoFactorService],
})
export class UserModule {}
