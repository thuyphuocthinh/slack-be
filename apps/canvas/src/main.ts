import { NestFactory } from '@nestjs/core';
import { CanvasModule } from './canvas.module';

async function bootstrap() {
  const app = await NestFactory.create(CanvasModule);
  await app.listen(process.env.port ?? 3000);
}
bootstrap();
