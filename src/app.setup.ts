import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import { DocumentBuilder, OpenAPIObject, SwaggerModule } from '@nestjs/swagger';

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

// Builds the OpenAPI document for this service. Factored out so BOTH the
// HTTP /docs mount (setupSwagger below) and the on-disk dump script
// (src/scripts/dump-openapi.ts) produce identical output — any difference
// between what the running app serves and the committed docs/openapi.yml
// means a drift that needs looking at.
export function buildOpenApiDocument(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('Samrajya Dwarpal')
    .setDescription('Users and authentication service for Project Samrajya')
    .setVersion('1.0')
    .addBearerAuth()
    // Unconditional server list so tooling (Postman import, OpenAPI code
    // generators) can target any env from the same committed YAML. Order
    // matters: Swagger UI defaults to the first entry.
    .addServer('http://localhost:3000', 'Local')
    .addServer('https://preview.samrajya-dwarpal.example', 'Preview')
    .addServer('https://api.samrajya-dwarpal.example', 'Production')
    .build();
  return SwaggerModule.createDocument(app, config);
}

// Swagger is separated because e2e tests do not need the /docs endpoint
// mounted; keeping it out of setupApp speeds up test boots.
//
// The UI stays public in every env (the owner's CV links to it). In
// production the "Try it out" button is disabled so an anonymous visitor
// cannot fire live requests from the docs page itself — they can still
// read the full OpenAPI document at /docs-json. Preview and local keep
// Try it out so the owner can click through from either place.
export function setupSwagger(app: INestApplication, appEnv: string): void {
  const swaggerOptions = appEnv === 'production'
    ? { swaggerOptions: { supportedSubmitMethods: [] as string[] } }
    : undefined;
  SwaggerModule.setup(
    'docs',
    app,
    () => buildOpenApiDocument(app),
    swaggerOptions,
  );
}
