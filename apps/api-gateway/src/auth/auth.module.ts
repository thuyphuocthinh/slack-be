import { Module } from '@nestjs/common';
import { ClientsModule } from '@nestjs/microservices';
import { NAME_SERVICE_TCP, PORT_TCP } from '@slack/constants';
import { getMicroserviceClientConfig } from '@slack/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { PassportModule } from '@nestjs/passport';
import { GoogleStrategy } from './strategy/google.strategy';

@Module({
  imports: [
    PassportModule,
    ClientsModule.registerAsync([
      getMicroserviceClientConfig(NAME_SERVICE_TCP.AUTH_SERVICE, PORT_TCP.AUTH_TCP_PORT),
    ]),
  ],
  controllers: [AuthController],
  providers: [AuthService, GoogleStrategy],
})
export class AuthModule {}
