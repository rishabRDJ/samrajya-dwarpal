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
  setupSwagger(app);
  await app.listen(process.env.PORT ?? 3000);
}
await bootstrap();
