import { Module } from '@nestjs/common';
import { UserController } from './user.controller';
import { UserService } from './services/user.service';
import { DatabaseModule } from '@slack/database';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserEntity } from './entity/user.entity';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { NAME_SERVICE_TCP, PORT_TCP } from '@slack/constants';
import { TwoFactorEntity } from './entity/two_factor.entity';
import { TwoFactorService } from './services/two_fa.service';
import { UserPreferenceService } from './services/user_preference.service';
import { UserSettingEntity } from './entity/user_preference.entity';

@Module({
  imports: [
    DatabaseModule,
    TypeOrmModule.forFeature([UserEntity, TwoFactorEntity, UserSettingEntity]),
    ClientsModule.register([
      {
        name: NAME_SERVICE_TCP.AUTH_SERVICE,
        transport: Transport.TCP,
        options: {
          host: 'localhost',
          port: PORT_TCP.AUTH_TCP_PORT,
        },
      },
    ]),
  ],
  controllers: [UserController],
  providers: [UserService, TwoFactorService, UserPreferenceService],
})
export class UserModule {}
