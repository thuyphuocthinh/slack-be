import { NestFactory } from '@nestjs/core';
import { IntegrationsModule } from './integrations.module';

async function bootstrap() {
  const app = await NestFactory.create(IntegrationsModule);
  await app.listen(process.env.port ?? 3000);
}
bootstrap();
