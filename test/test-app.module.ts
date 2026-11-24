import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LoggerModule } from 'nestjs-pino';
import { AdminModule } from '../src/admin/admin.module.js';
import { AppController } from '../src/app.controller.js';
import { AppService } from '../src/app.service.js';
import { AuthModule } from '../src/auth/auth.module.js';
import { JwtAuthGuard } from '../src/auth/guards/jwt-auth.guard.js';
import { RolesGuard } from '../src/auth/guards/roles.guard.js';
import { LoggingModule } from '../src/common/logging/logging.module.js';
import { buildPinoOptions } from '../src/common/logging/pino-options.js';
import { validateEnv } from '../src/env.validation.js';
import { UsersModule } from '../src/users/users.module.js';

// Mirror of AppModule without ThrottlerModule. @nestjs/throttler has an
// ESM-cycle issue under Jest's VM module runtime; stripping it here lets e2e
// tests run. Throttling itself is not covered by the PR B e2e spec.
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    // Silent pino by default so test output stays readable. The dedicated
    // logging.e2e-spec.ts bypasses this with a captured in-memory stream.
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        buildPinoOptions({
          appEnv: config.getOrThrow<string>('APP_ENV'),
          logLevel: 'silent',
        }),
    }),
    LoggingModule,
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'mysql' as const,
        host: config.getOrThrow<string>('DB_HOST'),
        port: Number(config.getOrThrow<string>('DB_PORT')),
        username: config.getOrThrow<string>('DB_USER'),
        password: config.getOrThrow<string>('DB_PASSWORD'),
        database: config.getOrThrow<string>('DB_NAME'),
        ssl: { rejectUnauthorized: false },
        timezone: 'Z',
        autoLoadEntities: true,
        synchronize: false,
      }),
    }),
    UsersModule,
    AuthModule,
    AdminModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class TestAppModule {}
