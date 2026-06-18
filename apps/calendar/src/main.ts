import { NestFactory } from '@nestjs/core';
import { CalendarModule } from './calendar.module';

async function bootstrap() {
  const app = await NestFactory.create(CalendarModule);
  await app.listen(process.env.port ?? 3000);
}
bootstrap();
