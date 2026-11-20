/* eslint-disable @typescript-eslint/no-explicit-any */
import type { INestApplication } from '@nestjs/common';
import type { Repository } from 'typeorm';
import type { RefreshToken } from '../src/auth/refresh-token.entity.js';
import type { User } from '../src/users/user.entity.js';

// Runtime bindings assigned in beforeAll, after the setup file's throttler
// mock is already in place. No top-level await — more portable across Node
// versions and CI environments.
let Test: typeof import('@nestjs/testing').Test;
let ValidationPipe: typeof import('@nestjs/common').ValidationPipe;
let getRepositoryToken: typeof import('@nestjs/typeorm').getRepositoryToken;
let argon2: typeof import('argon2');
let request: any;
let IsNull: typeof import('typeorm').IsNull;
let RefreshTokenEntity: typeof import('../src/auth/refresh-token.entity.js').RefreshToken;
let UserEntity: typeof import('../src/users/user.entity.js').User;
let UserRole: typeof import('../src/users/user.entity.js').UserRole;
let TestAppModule: typeof import('./test-app.module.js').TestAppModule;

const EMAIL = 'e2e-auth@test.local';
const USERNAME = 'e2e_auth_user';
const PASSWORD = 'correct horse battery staple';

describe('Auth (e2e)', () => {
  let app: INestApplication;
  let usersRepo: Repository<User>;
  let refreshRepo: Repository<RefreshToken>;

  async function wipe() {
    const prior = await usersRepo.findOne({
      where: [{ emailAddress: EMAIL }, { username: USERNAME }],
      withDeleted: true,
    });
    if (prior) {
      await refreshRepo.delete({ userId: prior.id });
      await usersRepo.delete({ id: prior.id });
    }
  }

  async function seedUser(opts: { deleted?: boolean } = {}): Promise<User> {
    const hash = await argon2.hash(PASSWORD);
    const user = await usersRepo.save(
      usersRepo.create({
        username: USERNAME,
        emailAddress: EMAIL,
        firstName: 'E',
        lastName: 'E',
        passwordHash: hash,
        role: UserRole.USER,
      }),
    );
    if (opts.deleted) {
      await usersRepo.softDelete({ id: user.id });
    }
    return user;
  }

  beforeAll(async () => {
    const commonMod = await import('@nestjs/common');
    ValidationPipe = commonMod.ValidationPipe;
    ({ Test } = await import('@nestjs/testing'));
    ({ getRepositoryToken } = await import('@nestjs/typeorm'));
    argon2 = await import('argon2');
    const supertestMod = await import('supertest');
    request = (supertestMod as any).default ?? supertestMod;
    ({ IsNull } = await import('typeorm'));
    ({ RefreshToken: RefreshTokenEntity } = await import('../src/auth/refresh-token.entity.js'));
    ({ User: UserEntity, UserRole } = await import('../src/users/user.entity.js'));
    ({ TestAppModule } = await import('./test-app.module.js'));

    const moduleRef = await Test.createTestingModule({
      imports: [TestAppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1', { exclude: ['health'] });
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();

    usersRepo = moduleRef.get(getRepositoryToken(UserEntity));
    refreshRepo = moduleRef.get(getRepositoryToken(RefreshTokenEntity));
  });

  beforeEach(async () => {
    await wipe();
  });

  afterAll(async () => {
    await wipe();
    await app.close();
  });

  it('logs in with email and returns both tokens', async () => {
    await seedUser();
    const res = await request(app.getHttpServer())
      .post('/v1/auth/login')
      .send({ identifier: EMAIL, password: PASSWORD })
      .expect(200);
    expect(res.body.accessToken).toBeDefined();
    expect(res.body.refreshToken).toBeDefined();
    expect(res.body.accessTokenExpiresIn).toBeGreaterThan(0);
    expect(new Date(res.body.refreshTokenExpiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it('logs in with username too', async () => {
    await seedUser();
    const res = await request(app.getHttpServer())
      .post('/v1/auth/login')
      .send({ identifier: USERNAME, password: PASSWORD })
      .expect(200);
    expect(res.body.accessToken).toBeDefined();
  });

  it('returns the same 401 shape for wrong password and unknown user', async () => {
    await seedUser();
    const wrong = await request(app.getHttpServer())
      .post('/v1/auth/login')
      .send({ identifier: EMAIL, password: 'nope but long enough' })
      .expect(401);
    const unknown = await request(app.getHttpServer())
      .post('/v1/auth/login')
      .send({ identifier: 'nobody@nowhere.local', password: 'nope but long enough' })
      .expect(401);
    expect(wrong.body).toEqual(unknown.body);
  });

  it('refuses login for a soft-deleted user', async () => {
    await seedUser({ deleted: true });
    await request(app.getHttpServer())
      .post('/v1/auth/login')
      .send({ identifier: EMAIL, password: PASSWORD })
      .expect(401);
  });

  it('rotates refresh tokens and invalidates the old one', async () => {
    await seedUser();
    const login = await request(app.getHttpServer())
      .post('/v1/auth/login')
      .send({ identifier: EMAIL, password: PASSWORD })
      .expect(200);
    const oldRefresh = login.body.refreshToken;

    const rotated = await request(app.getHttpServer())
      .post('/v1/auth/refresh')
      .send({ refreshToken: oldRefresh })
      .expect(200);
    expect(rotated.body.refreshToken).not.toBe(oldRefresh);

    await request(app.getHttpServer())
      .post('/v1/auth/refresh')
      .send({ refreshToken: oldRefresh })
      .expect(401);
  });

  it('reusing a revoked token revokes every active session for that user', async () => {
    const user = await seedUser();
    const login = await request(app.getHttpServer())
      .post('/v1/auth/login')
      .send({ identifier: EMAIL, password: PASSWORD })
      .expect(200);
    const firstRefresh = login.body.refreshToken;

    const rotated = await request(app.getHttpServer())
      .post('/v1/auth/refresh')
      .send({ refreshToken: firstRefresh })
      .expect(200);
    const secondRefresh = rotated.body.refreshToken;

    await request(app.getHttpServer())
      .post('/v1/auth/refresh')
      .send({ refreshToken: firstRefresh })
      .expect(401);

    const active = await refreshRepo.count({
      where: { userId: user.id, revokedAt: IsNull() },
    });
    expect(active).toBe(0);

    await request(app.getHttpServer())
      .post('/v1/auth/refresh')
      .send({ refreshToken: secondRefresh })
      .expect(401);
  });

  it('a protected route returns 401 without a bearer token', async () => {
    await request(app.getHttpServer()).get('/v1/me').expect(401);
  });
});
