import { Module } from '@nestjs/common';
import { DatabaseModule } from '@slack/database';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthEntity } from './entity/auth.entity';
import { SessionEntity } from './entity/session.entity';

@Module({
  imports: [
    DatabaseModule,
    TypeOrmModule.forFeature([AuthEntity, SessionEntity]),
  ],
  controllers: [AuthController],
  providers: [AuthService],
})
export class AuthModule {}
