import { ValidationPipe } from '@nestjs/common';
import type { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface';
import type { INestApplication } from '@nestjs/common';
import type { Express } from 'express';
import * as cookieParser from 'cookie-parser';
import { ApiExceptionFilter } from './api-exception.filter';
import { resolveTrustProxyHops } from './trust-proxy.config';
import { createAuthHttpConfig } from '../../modules/auth/http/auth-http.config';

export function configureHttpApplication(app: INestApplication): void {
  const authHttpConfig = createAuthHttpConfig();

  app.use(cookieParser());
  app.enableCors(createCorsOptions(authHttpConfig.trustedWebOrigins));
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
      forbidUnknownValues: true,
    }),
  );
  app.useGlobalFilters(new ApiExceptionFilter());
  const expressApp = app.getHttpAdapter().getInstance() as Express;
  // See trust-proxy.config.ts: without this, req.ip (what ThrottlerGuard keys throttling on)
  // resolves to the Railway edge's own address for every request behind a reverse proxy.
  expressApp.set('trust proxy', resolveTrustProxyHops());
  expressApp.disable('x-powered-by');
}

function createCorsOptions(trustedWebOrigins: readonly string[]): CorsOptions {
  return {
    credentials: true,
    origin: (origin, callback) => {
      if (!origin) {
        callback(null, true);
        return;
      }

      callback(null, trustedWebOrigins.includes(origin));
    },
  };
}
