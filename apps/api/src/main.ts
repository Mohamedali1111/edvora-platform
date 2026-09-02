import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureHttpApplication } from './infrastructure/http/http-bootstrap';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { rawBody: true });
  // Wires Nest's OnModuleDestroy lifecycle (PrismaService's pool shutdown) to SIGTERM/SIGINT,
  // so a Railway redeploy/restart drains the PostgreSQL pool cleanly instead of the process
  // being killed out from under open connections. No custom signal handling is added here -
  // this is Nest's own default shutdown-hook listener.
  app.enableShutdownHooks();
  configureHttpApplication(app);
  await app.listen(process.env.PORT ?? 3001);
}

void bootstrap();
