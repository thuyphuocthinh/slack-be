import { NestFactory } from '@nestjs/core';
import { VideoCallModule } from './video-call.module';

async function bootstrap() {
  const app = await NestFactory.create(VideoCallModule);
  await app.listen(process.env.port ?? 3000);
}
bootstrap();
