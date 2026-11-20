import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Prefix every route with /v1 so DTO descriptions and client calls agree.
  // Health stays unprefixed so monitors and orchestrators don't track the
  // API version.
  app.setGlobalPrefix('v1', { exclude: ['health'] });

  // whitelist: strip properties not declared on the DTO.
  // forbidNonWhitelisted: 400 if the client sends unknown fields (louder than silent strip).
  // transform: use class-transformer so numeric path params etc. arrive typed.
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  await app.listen(process.env.PORT ?? 3000);
}
await bootstrap();
