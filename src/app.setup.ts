import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

// Single source of truth for global app configuration. main.ts and e2e tests
// both call this, so tests cannot drift from production config.
export function setupApp(app: INestApplication): void {
  // URI versioning in place of setGlobalPrefix('v1'). Default version is '1',
  // so an unversioned controller handler lives at /v1/<path>. A future /v2
  // controller slots in next to the current one without touching this setup.
  // Routes that opt out with @Version(VERSION_NEUTRAL) stay unversioned
  // (used for /health so monitoring stays stable across API versions).
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });

  // whitelist: strip properties not on the DTO.
  // forbidNonWhitelisted: 400 on unknown fields (louder than silent strip).
  // transform: convert plain objects to DTO instances so class-validator runs
  // and path/query primitives are coerced to their declared types.
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
}

// Swagger is separated because e2e tests do not need the /docs endpoint
// mounted; keeping it out of setupApp speeds up test boots.
export function setupSwagger(app: INestApplication): void {
  const openApi = new DocumentBuilder()
    .setTitle('Samrajya Dwarpal')
    .setDescription('Users and authentication service for Project Samrajya')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  SwaggerModule.setup('docs', app, () =>
    SwaggerModule.createDocument(app, openApi),
  );
}
