import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ApiGatewayController } from './api-gateway.controller';
import { ApiGatewayService } from './api-gateway.service';
import { AuthModule } from './auth/auth.module';
import { CamelCaseMiddleware } from './common/middlewares/camelCase.middleware';

@Module({
  imports: [AuthModule],
  controllers: [ApiGatewayController],
  providers: [ApiGatewayService],
})

export class ApiGatewayModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(CamelCaseMiddleware)
      .forRoutes('*');
  }
}
