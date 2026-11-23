/* eslint-disable @typescript-eslint/no-explicit-any */
import type { INestApplication } from '@nestjs/common';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Writable } from 'node:stream';
import type { Repository } from 'typeorm';
import type { User } from '../src/users/user.entity.js';

let Test: typeof import('@nestjs/testing').Test;
let getRepositoryToken: typeof import('@nestjs/typeorm').getRepositoryToken;
let argon2: typeof import('argon2');
let request: any;
let UserEntity: typeof import('../src/users/user.entity.js').User;
let UserRole: typeof import('../src/users/user.entity.js').UserRole;
let setupApp: typeof import('../src/app.setup.js').setupApp;
let buildPinoOptions: typeof import('../src/common/logging/pino-options.js').buildPinoOptions;
let LoggerModuleType: typeof import('nestjs-pino').LoggerModule;
let LoggerType: typeof import('nestjs-pino').Logger;
let LoggingModule: typeof import('../src/common/logging/logging.module.js').LoggingModule;
let validateEnv: typeof import('../src/env.validation.js').validateEnv;
let AdminModule: typeof import('../src/admin/admin.module.js').AdminModule;
let AppController: typeof import('../src/app.controller.js').AppController;
let AppService: typeof import('../src/app.service.js').AppService;
let AuthModule: typeof import('../src/auth/auth.module.js').AuthModule;
let JwtAuthGuard: typeof import('../src/auth/guards/jwt-auth.guard.js').JwtAuthGuard;
let RolesGuard: typeof import('../src/auth/guards/roles.guard.js').RolesGuard;
let UsersModule: typeof import('../src/users/users.module.js').UsersModule;

// A writable sink that parses each pino line into JSON so individual
// tests can filter the captured stream by field.
function makeLogCapture() {
  const lines: Record<string, unknown>[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      for (const raw of chunk.toString().split('\n')) {
        if (!raw) continue;
        try {
          lines.push(JSON.parse(raw));
        } catch {
          // ignore malformed lines (pino-pretty transport output etc.)
        }
      }
      cb();
    },
  });
  return { lines, stream };
}

const EMAIL = 'e2e-log@test.local';
const USERNAME = 'e2e_log_user';
const PASSWORD = 'correct horse battery staple';

describe('Logging (e2e)', () => {
  let app: INestApplication;
  let capture: ReturnType<typeof makeLogCapture>;
  let usersRepo: Repository<User>;

  async function wipe() {
    const prior = await usersRepo.find({
      where: [{ emailAddress: EMAIL }, { username: USERNAME }],
      withDeleted: true,
    });
    for (const row of prior) {
      await usersRepo.delete({ id: row.id });
    }
  }

  async function seedUser(): Promise<User> {
    const hash = await argon2.hash(PASSWORD);
    return usersRepo.save(
      usersRepo.create({
        username: USERNAME,
        emailAddress: EMAIL,
        firstName: 'L',
        lastName: 'L',
        passwordHash: hash,
        role: UserRole.USER,
      }),
    );
  }

  beforeAll(async () => {
    ({ Test } = await import('@nestjs/testing'));
    ({ getRepositoryToken } = await import('@nestjs/typeorm'));
    argon2 = await import('argon2');
    const supertestMod = await import('supertest');
    request = (supertestMod as any).default ?? supertestMod;
    ({ User: UserEntity, UserRole } = await import('../src/users/user.entity.js'));
    ({ setupApp } = await import('../src/app.setup.js'));
    ({ buildPinoOptions } = await import('../src/common/logging/pino-options.js'));
    ({ LoggerModule: LoggerModuleType, Logger: LoggerType } = await import('nestjs-pino'));
    ({ LoggingModule } = await import('../src/common/logging/logging.module.js'));
    ({ validateEnv } = await import('../src/env.validation.js'));
    ({ AdminModule } = await import('../src/admin/admin.module.js'));
    ({ AppController } = await import('../src/app.controller.js'));
    ({ AppService } = await import('../src/app.service.js'));
    ({ AuthModule } = await import('../src/auth/auth.module.js'));
    ({ JwtAuthGuard } = await import('../src/auth/guards/jwt-auth.guard.js'));
    ({ RolesGuard } = await import('../src/auth/guards/roles.guard.js'));
    ({ UsersModule } = await import('../src/users/users.module.js'));

    capture = makeLogCapture();

    // A capture-wired equivalent of TestAppModule: silent default is
    // replaced with level=info and a Writable destination that collects
    // every emitted JSON line for inspection.
    @Module({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
        LoggerModuleType.forRoot(
          // Hardcode appEnv='preview' here (not the env's APP_ENV) so the
          // pino-pretty transport is NOT attached: transports run in a
          // worker thread and ignore the `stream` tuple we pass. Raw JSON
          // goes directly to capture.stream.
          buildPinoOptions({
            appEnv: 'preview',
            logLevel: 'info',
            destination: capture.stream,
          }),
        ),
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
    class CaptureAppModule {}

    const moduleRef = await Test.createTestingModule({
      imports: [CaptureAppModule],
    }).compile();

    app = moduleRef.createNestApplication({ bufferLogs: true });
    app.useLogger(app.get(LoggerType));
    setupApp(app);
    await app.init();

    usersRepo = moduleRef.get(getRepositoryToken(UserEntity));
  });

  beforeEach(async () => {
    capture.lines.length = 0;
    await wipe();
  });

  afterAll(async () => {
    await wipe();
    await app.close();
  });

  it('every response carries an x-request-id header', async () => {
    const res = await request(app.getHttpServer()).get('/health').expect(200);
    expect(res.headers['x-request-id']).toBeDefined();
    expect(res.headers['x-request-id']).toMatch(/^[A-Za-z0-9-]{8,64}$/);
  });

  it('a valid incoming x-request-id is echoed unchanged in the response header', async () => {
    const incoming = '11111111-2222-3333-4444-555555555555';
    const res = await request(app.getHttpServer())
      .get('/health')
      .set('x-request-id', incoming)
      .expect(200);
    expect(res.headers['x-request-id']).toBe(incoming);
  });

  it('a malformed incoming x-request-id is replaced with a new UUID', async () => {
    const res = await request(app.getHttpServer())
      .get('/health')
      .set('x-request-id', 'has spaces')
      .expect(200);
    expect(res.headers['x-request-id']).not.toBe('has spaces');
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('a failed login log line carries the same reqId as the response header', async () => {
    await seedUser();
    const res = await request(app.getHttpServer())
      .post('/v1/auth/login')
      .set('x-request-id', '22222222-aaaa-bbbb-cccc-444444444444')
      .send({ identifier: EMAIL, password: 'wrong but long enough' })
      .expect(401);

    const reqId = res.headers['x-request-id'];
    expect(reqId).toBe('22222222-aaaa-bbbb-cccc-444444444444');

    const failed = capture.lines.find(
      (l) => l.event === 'auth.login.failed' && l.reqId === reqId,
    );
    expect(failed).toBeDefined();
    // Captured line must have the base fields and the context.
    expect(failed).toMatchObject({
      service: 'dwarpal',
      context: 'AuthService.login',
      reason: 'wrong_password',
      identifierType: 'email',
    });
  });

  it('login log lines contain NO password value anywhere', async () => {
    await seedUser();
    await request(app.getHttpServer())
      .post('/v1/auth/login')
      .send({ identifier: EMAIL, password: 'guess-my-password-please' })
      .expect(401);

    const serialized = JSON.stringify(capture.lines);
    expect(serialized).not.toContain('guess-my-password-please');
  });

  it('GET /v1/auth/availability logs no email address value (query string is stripped)', async () => {
    await request(app.getHttpServer())
      .get('/v1/auth/availability?emailAddress=sneaky@example.com')
      .expect(200);

    const serialized = JSON.stringify(capture.lines);
    expect(serialized).not.toContain('sneaky@example.com');
    // The URL that IS logged is the path alone.
    const requestLine = capture.lines.find(
      (l) => (l.req as any)?.url === '/v1/auth/availability',
    );
    expect(requestLine).toBeDefined();
  });

  it('GET /health produces NO request log line (silenced path)', async () => {
    await request(app.getHttpServer()).get('/health').expect(200);
    const healthReqLine = capture.lines.find(
      (l) => (l.req as any)?.url === '/health',
    );
    expect(healthReqLine).toBeUndefined();
  });
});
