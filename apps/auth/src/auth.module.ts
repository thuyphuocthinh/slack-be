import { Module } from '@nestjs/common';
import { DatabaseModule } from '@slack/database';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { OAuthController } from './oauth.controller';
import { OAuthService } from './oauth.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthEntity } from './entity/auth.entity';
import { SessionEntity } from './entity/session.entity';
import { OAuthClientEntity } from './entity/oauth-client.entity';
import { OAuthAuthCodeEntity } from './entity/oauth-auth-code.entity';
import { OAuthTokenEntity } from './entity/oauth-token.entity';
import { ClientsModule } from '@nestjs/microservices';
import { NAME_SERVICE_TCP, PORT_TCP } from '@slack/constants';
import { getMicroserviceClientConfig } from '@slack/common';
import { VerificationEntity } from './entity/verification.entity';
import { JwtModule } from '@nestjs/jwt';
import { GoogleStrategy } from './strategy/google.strategy';
import { CachedModule } from '@slack/cached';
import { QueueModule, EQueueName } from '@slack/queue';

import { UserDeviceEntity } from './entity/user-device.entity';

@Module({
  imports: [
    DatabaseModule,
    QueueModule.forRoot(),
    QueueModule.forFeature([EQueueName.EMAIL_QUEUE]),
    CachedModule.forRoot(),
    TypeOrmModule.forFeature([
      AuthEntity,
      SessionEntity,
      VerificationEntity,
      UserDeviceEntity,
      OAuthClientEntity,
      OAuthAuthCodeEntity,
      OAuthTokenEntity,
    ]),
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'fallback_secret',
    }),
    ClientsModule.registerAsync([
      getMicroserviceClientConfig(NAME_SERVICE_TCP.USER_SERVICE, PORT_TCP.USER_TCP_PORT),
      getMicroserviceClientConfig(NAME_SERVICE_TCP.NOTIFICATION_SERVICE, PORT_TCP.NOTIFICATION_TCP_PORT),
    ]),
  ],
  controllers: [AuthController, OAuthController],
  providers: [AuthService, OAuthService, GoogleStrategy],
})
export class AuthModule {}
