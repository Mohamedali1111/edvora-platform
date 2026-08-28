import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureHttpApplication } from './infrastructure/http/http-bootstrap';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  configureHttpApplication(app);
  await app.listen(process.env.PORT ?? 3001);
}

void bootstrap();
