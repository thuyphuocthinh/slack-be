import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ApiGatewayController } from './api-gateway.controller';
import { ApiGatewayService } from './api-gateway.service';
import { AuthModule } from './auth/auth.module';
import { CamelCaseMiddleware } from './common/middlewares/camelCase.middleware';
import { APP_GUARD } from '@nestjs/core';
import { JwtAuthGuard } from './common/guards/jwt_auth.guard';
import { JwtModule } from '@nestjs/jwt';
import { CachedModule } from '@slack/cached';
import { ConfigModule } from '@nestjs/config';
import { UserModule } from './user/user.module';
import { ResourceModule } from './resource/resource.module';
import { WorkspaceModule } from './workspace/workspace.module';
import { NotificationModule } from './notification/notification.module';
import { TaskModule } from './task/task.module';
import { ChannelModule } from './channel/channel.module';
import { MessageModule } from './message/message.module';
import { VideoCallModule } from './video-call/video-call.module';
import { RateLimitGuard } from './common/guards/rate-limit.guard';
import { SubscriptionGuard } from './common/guards/subscription.guard';
import { WebhookReceiverModule } from './webhook-receiver/webhook-receiver.module';
import { BillingModule } from './billing/billing.module';
import { AiModule } from './ai/ai.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    AuthModule,
    UserModule,
    ResourceModule,
    WorkspaceModule,
    NotificationModule,
    TaskModule,
    ChannelModule,
    MessageModule,
    VideoCallModule,
    WebhookReceiverModule,
    BillingModule,
    AiModule,

    JwtModule.register({
      secret: process.env.JWT_SECRET || 'fallback_secret',
    }),
    CachedModule.forRoot(),
  ],
  controllers: [ApiGatewayController],
  providers: [
    ApiGatewayService,
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: RateLimitGuard,
    },
    {
      provide: APP_GUARD,
      useClass: SubscriptionGuard,
    },
  ],
})
export class ApiGatewayModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(CamelCaseMiddleware).forRoutes('*');
  }
}
