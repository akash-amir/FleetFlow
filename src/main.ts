import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module.js';

async function bootstrap() {
  // rawBody: true keeps req.rawBody (the exact bytes Stripe signed) around
  // alongside Nest's normal JSON-parsed req.body for every route — needed
  // by the webhook's signature check (see StripeWebhookController), without
  // disabling body parsing for the rest of the API.
  const app = await NestFactory.create(AppModule, { rawBody: true });
  app.use(cookieParser());
  // The frontend (web/) runs on a different origin in dev (localhost:3001
  // vs this API's localhost:3000) and needs the browser to send/accept the
  // httpOnly refresh cookie on every request — that only happens if the
  // browser is told the request is credentialed AND the server echoes back
  // one explicit allowed origin (never '*', which is incompatible with
  // credentialed requests by spec).
  app.enableCors({ origin: process.env.FRONTEND_ORIGIN || 'http://localhost:3001', credentials: true });
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  await app.listen(process.env.PORT ?? 3000);
}
await bootstrap();
