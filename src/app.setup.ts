import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

export function setupApp(app: INestApplication): void {
  // /v1 prefix for every route except /health (monitors should not track
  // the API version).
  app.setGlobalPrefix('v1', { exclude: ['health'] });

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
