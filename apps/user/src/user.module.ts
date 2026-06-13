import { Module } from '@nestjs/common';
import { UserController } from './user.controller';
import { UserService } from './services/user.service';
import { DatabaseModule } from '@slack/database';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserEntity } from './entity/user.entity';
import { ClientsModule } from '@nestjs/microservices';
import { NAME_SERVICE_TCP, PORT_TCP } from '@slack/constants';
import { getMicroserviceClientConfig } from '@slack/common';
import { TwoFactorEntity } from './entity/two_factor.entity';
import { TwoFactorService } from './services/two_fa.service';
import { UserPreferenceService } from './services/user_preference.service';
import { UserSettingEntity } from './entity/user_preference.entity';
import { UserFcmTokenEntity } from './entity/user_fcm_token.entity';
import { CachedModule } from '@slack/cached';

@Module({
  imports: [
    DatabaseModule,
    CachedModule.forRoot(),
    TypeOrmModule.forFeature([UserEntity, TwoFactorEntity, UserSettingEntity, UserFcmTokenEntity]),
    ClientsModule.registerAsync([
      getMicroserviceClientConfig(NAME_SERVICE_TCP.AUTH_SERVICE, PORT_TCP.AUTH_TCP_PORT),
    ]),
  ],
  controllers: [UserController],
  providers: [UserService, TwoFactorService, UserPreferenceService],
})
export class UserModule {}
