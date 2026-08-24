import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { EdgeAuthService } from './edge-auth.service';
import { EdgeAuthController } from './edge-auth.controller';

@Module({
  imports: [
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'fallback_secret',
      signOptions: { expiresIn: '1h' },
    }),
  ],
  controllers: [EdgeAuthController],
  providers: [EdgeAuthService],
  exports: [JwtModule],
})
export class EdgeAuthModule {}
