import { NestFactory } from '@nestjs/core';
import { WorkspaceModule } from './workspace.module';

async function bootstrap() {
  const app = await NestFactory.create(WorkspaceModule);
  await app.listen(process.env.port ?? 3000);
}
bootstrap();
