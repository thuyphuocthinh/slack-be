import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { CachedModule } from '@slack/cached';
import { GoogleStrategy } from './strategies/google.strategy';
import { UserIntegrationEntity } from './entity/user-integration.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([UserIntegrationEntity]),
    CachedModule.forRoot(),
  ],
  controllers: [AuthController],
  providers: [AuthService, GoogleStrategy],
  exports: [AuthService],
})
export class AuthModule { }
