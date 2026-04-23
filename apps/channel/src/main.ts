import { NestFactory } from '@nestjs/core';
import { ChannelModule } from './channel.module';

async function bootstrap() {
  const app = await NestFactory.create(ChannelModule);
  await app.listen(process.env.port ?? 3000);
}
bootstrap();
