import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module.js';
import { setupApp, setupSwagger } from './app.setup.js';

async function bootstrap() {
  // bufferLogs holds every log line until useLogger is set below, so Nest's
  // own startup lines ("Mapped {...}") go through pino too — one JSON
  // schema from the first boot line onward.
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  setupApp(app);
  // APP_ENV is validated at boot (src/env.validation.ts); read it here to
  // tell Swagger whether to disable Try it out (production only).
  const appEnv = app.get(ConfigService).getOrThrow<string>('APP_ENV');
  setupSwagger(app, appEnv);
  await app.listen(process.env.PORT ?? 3000);
}
await bootstrap();
