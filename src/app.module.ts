import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LoggerModule } from 'nestjs-pino';
import { AdminModule } from './admin/admin.module.js';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { AuthModule } from './auth/auth.module.js';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard.js';
import { RolesGuard } from './auth/guards/roles.guard.js';
import { LoggingModule } from './common/logging/logging.module.js';
import { buildPinoOptions } from './common/logging/pino-options.js';
import { validateEnv } from './env.validation.js';
import { UsersModule } from './users/users.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    // nestjs-pino: structured JSON logs with reqId attached per request via
    // AsyncLocalStorage. buildPinoOptions is factored out for unit testing
    // — see common/logging/pino-options.spec.ts.
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        buildPinoOptions({
          appEnv: config.getOrThrow<string>('APP_ENV'),
          logLevel: config.get<string>('LOG_LEVEL'),
        }),
    }),
    // @Global() LoggingModule provides ScopedLogger to every feature module.
    LoggingModule,
    // Baseline throttle: 20 requests / minute per IP. Routes can lower the
    // limit with @Throttle() (login does: 5/min). The guard reads these and
    // the @Throttle overrides.
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 20 }]),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'mysql' as const,
        host: config.getOrThrow<string>('DB_HOST'),
        port: Number(config.getOrThrow<string>('DB_PORT')),
        username: config.getOrThrow<string>('DB_USER'),
        password: config.getOrThrow<string>('DB_PASSWORD'),
        database: config.getOrThrow<string>('DB_NAME'),
        ssl: {
          rejectUnauthorized: false,
        },
        // Read and write DATETIME values as UTC. MySQL stores DATETIME without
        // a zone, so mysql2 picks one when serializing JS Date values; without
        // this, it uses the app server's local zone. 'Z' = UTC.
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
    // Register the JWT guard app-wide. Every route is protected by default;
    // opt out with @Public(). APP_GUARD lets the guard participate in DI
    // (so it can inject Reflector) unlike app.useGlobalGuards().
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    // RolesGuard runs after JwtAuthGuard. On routes without @Roles() it is a
    // no-op, so registering it globally costs nothing per request.
    { provide: APP_GUARD, useClass: RolesGuard },
    // ThrottlerGuard enforces the ThrottlerModule config plus any @Throttle()
    // overrides. Runs after auth guards so unauthenticated hits still count.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
