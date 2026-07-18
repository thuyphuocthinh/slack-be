import { NestFactory } from '@nestjs/core';
import { WinstonModule } from 'nest-winston';
import { getLoggerConfig } from '@slack/common';
import { ApiGatewayModule } from './api-gateway.module';
import * as dotenv from 'dotenv';
import { ValidationPipe, BadRequestException } from '@nestjs/common';
import { VALIDATION_ERROR } from '@slack/constants';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cluster from 'node:cluster';
import { availableParallelism } from 'node:os';

async function bootstrap() {
  dotenv.config();

  if (cluster.isPrimary) {
    // GATEWAY_CLUSTER_WORKERS cho phép giới hạn số worker khi chạy local
    // (mặc định fork theo số CPU core, dư thừa cho máy dev nhiều core).
    const numCPUs = parseInt(process.env.GATEWAY_CLUSTER_WORKERS || '', 10) || availableParallelism();
    console.log(`Primary process ${process.pid} is running. Forking ${numCPUs} workers...`);

    for (let i = 0; i < numCPUs; i++) {
      cluster.fork();
    }

    cluster.on('exit', (worker, code, signal) => {
      console.log(`Worker ${worker.process.pid} died. Forking a new one...`);
      cluster.fork();
    });
  } else {
    const app = await NestFactory.create(ApiGatewayModule, {
      logger: WinstonModule.createLogger(getLoggerConfig('GATEWAY')),
      rawBody: true, // Required for Stripe webhook signature verification
    });

    const expressApp = app.getHttpAdapter().getInstance();
    if (typeof expressApp.set === 'function') {
      expressApp.set('trust proxy', true);
    }

    app.enableShutdownHooks();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
        exceptionFactory: (errors) => {
          const message = errors
            .map((error) => Object.values(error.constraints || {}).join(', '))
            .join('; ');
          return new BadRequestException({
            ...VALIDATION_ERROR.BAD_REQUEST,
            message: `${VALIDATION_ERROR.BAD_REQUEST.message}: ${message}`,
          });
        },
      }),
    );
    app.useGlobalFilters(new HttpExceptionFilter());
    app.useGlobalInterceptors(new ResponseInterceptor());
    const frontendUrl = process.env.FRONTEND_URL;
    const allowedOrigins = [
      'http://localhost:5173',
      'http://127.0.0.1:5173',
      'https://slack-fe.tpt.io.vn',
      'https://slack.tpt.io.vn',
      'https://tpt.io.vn',
    ];
    if (frontendUrl) {
      const parsedOrigins = frontendUrl.split(',').map((url) => url.trim());
      allowedOrigins.push(...parsedOrigins);
    }
    app.enableCors({
      origin: allowedOrigins,
      credentials: true,
    });
    app.setGlobalPrefix('api/v1', {
      exclude: ['metrics'],
    });

    const config = new DocumentBuilder()
      .setTitle('Slack API')
      .setDescription('API docs')
      .setVersion('1.0')
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('docs', app, document, {
      explorer: true,
      jsonDocumentUrl: '/openapi.json',
      swaggerUrl: '/openapi.json',
      customJsStr: `
        document.addEventListener('DOMContentLoaded', function () {
          var link = document.createElement('a');
          link.href = '/openapi.json';
          link.target = '_blank';
          link.rel = 'noopener';
          link.textContent = 'openapi.json';
          link.style.cssText = 'position:fixed;top:120px;right:20px;z-index:9999;padding:6px 14px;background:#89bf04;color:#1b1b1b;font:600 13px sans-serif;border-radius:4px;text-decoration:none;';
          document.body.appendChild(link);
        });
      `,
    });

    const port = process.env.GATEWAY_PORT || 3000;
    await app.listen(port);
    console.log(`Worker ${process.pid} started. Gateway listening on http://localhost:${port}`);
  }
}
bootstrap();


/*

1.  **Kiểm tra Primary process:** Sử dụng `cluster.isPrimary` để xác định tiến trình chính.
2.  **Fork Workers:** Sử dụng `availableParallelism()` (phiên bản hiện đại hơn của `os.cpus().length`) để tự động tạo ra số lượng worker tương ứng với số nhân CPU của máy bạn.
3.  **Tự động hồi phục:** Nếu một worker bị chết (`exit`), tiến trình chính sẽ tự động fork một worker mới để thay thế.
4.  **Worker chạy NestJS:** Các tiến trình con sẽ khởi tạo ứng dụng NestJS và lắng nghe trên cùng một cổng (Port 3000). Hệ điều hành sẽ tự điều phối (Load balance) các request đến các worker này.

*/