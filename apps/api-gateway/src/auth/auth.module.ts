import { Module } from '@nestjs/common';
import { ClientsModule } from '@nestjs/microservices';
import { NAME_SERVICE_TCP, PORT_TCP } from '@slack/constants';
import { getMicroserviceClientConfig } from '@slack/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { OAuthController } from './oauth.controller';
import { OAuthService } from './oauth.service';
import { PassportModule } from '@nestjs/passport';
import { GoogleStrategy } from './strategy/google.strategy';
import { WorkspaceModule } from '../workspace/workspace.module';
import { ChannelModule } from '../channel/channel.module';

@Module({
  imports: [
    PassportModule,
    WorkspaceModule,
    ChannelModule,
    ClientsModule.registerAsync([
      getMicroserviceClientConfig(NAME_SERVICE_TCP.AUTH_SERVICE, PORT_TCP.AUTH_TCP_PORT),
    ]),
  ],
  controllers: [AuthController, OAuthController],
  providers: [AuthService, OAuthService, GoogleStrategy],
})
export class AuthModule {}
