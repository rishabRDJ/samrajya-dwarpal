/* eslint-disable @typescript-eslint/no-explicit-any */
import type { INestApplication } from '@nestjs/common';
import type { Repository } from 'typeorm';
import type { RefreshToken } from '../src/auth/refresh-token.entity.js';
import type { User } from '../src/users/user.entity.js';

let Test: typeof import('@nestjs/testing').Test;
let getRepositoryToken: typeof import('@nestjs/typeorm').getRepositoryToken;
let argon2: typeof import('argon2');
let request: any;
let IsNull: typeof import('typeorm').IsNull;
let RefreshTokenEntity: typeof import('../src/auth/refresh-token.entity.js').RefreshToken;
let UserEntity: typeof import('../src/users/user.entity.js').User;
let UserRole: typeof import('../src/users/user.entity.js').UserRole;
let TestAppModule: typeof import('./test-app.module.js').TestAppModule;
let setupApp: typeof import('../src/app.setup.js').setupApp;

const EMAIL = 'e2e-password@test.local';
const USERNAME = 'e2e_password_user';
const PASSWORD = 'correct horse battery staple';
const NEW_PASSWORD = 'a new sufficiently long password';

describe('Password change (e2e)', () => {
  let app: INestApplication;
  let usersRepo: Repository<User>;
  let refreshRepo: Repository<RefreshToken>;

  async function wipe() {
    const prior = await usersRepo.find({
      where: [{ emailAddress: EMAIL }, { username: USERNAME }],
      withDeleted: true,
    });
    for (const row of prior) {
      await refreshRepo.delete({ userId: row.id });
      await usersRepo.delete({ id: row.id });
    }
  }

  async function seedUser(): Promise<User> {
    const hash = await argon2.hash(PASSWORD);
    return usersRepo.save(
      usersRepo.create({
        username: USERNAME,
        emailAddress: EMAIL,
        firstName: 'Pw',
        lastName: 'User',
        passwordHash: hash,
        role: UserRole.USER,
      }),
    );
  }

  async function loginPair(password = PASSWORD): Promise<{ access: string; refresh: string }> {
    const res = await request(app.getHttpServer())
      .post('/v1/auth/login')
      .send({ identifier: EMAIL, password })
      .expect(200);
    return { access: res.body.accessToken, refresh: res.body.refreshToken };
  }

  beforeAll(async () => {
    ({ Test } = await import('@nestjs/testing'));
    ({ getRepositoryToken } = await import('@nestjs/typeorm'));
    argon2 = await import('argon2');
    const supertestMod = await import('supertest');
    request = (supertestMod as any).default ?? supertestMod;
    ({ IsNull } = await import('typeorm'));
    ({ RefreshToken: RefreshTokenEntity } = await import('../src/auth/refresh-token.entity.js'));
    ({ User: UserEntity, UserRole } = await import('../src/users/user.entity.js'));
    ({ TestAppModule } = await import('./test-app.module.js'));
    ({ setupApp } = await import('../src/app.setup.js'));

    const moduleRef = await Test.createTestingModule({
      imports: [TestAppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    setupApp(app);
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

  it('returns 401 without a bearer token', async () => {
    await request(app.getHttpServer())
      .post('/v1/users/me/password')
      .send({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD })
      .expect(401);
  });

  it('changes the password, returns fresh tokens, and revokes every prior refresh token', async () => {
    const user = await seedUser();
    const { access, refresh: oldRefresh } = await loginPair();

    const res = await request(app.getHttpServer())
      .post('/v1/users/me/password')
      .set('Authorization', `Bearer ${access}`)
      .send({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD })
      .expect(200);

    expect(res.body.accessToken).toBeDefined();
    expect(res.body.refreshToken).toBeDefined();
    expect(res.body.refreshToken).not.toBe(oldRefresh);

    // After the change: old refresh is revoked, the brand new one is active.
    // Check the DB directly BEFORE attempting a reuse — attempting to refresh
    // with the revoked old token would trigger reuse detection, which
    // deliberately burns every session for the user (including the new one).
    const afterChange = await refreshRepo.count({
      where: { userId: user.id, revokedAt: IsNull() },
    });
    expect(afterChange).toBe(1);

    // Old refresh token is dead.
    await request(app.getHttpServer())
      .post('/v1/auth/refresh')
      .send({ refreshToken: oldRefresh })
      .expect(401);

    // Reuse detection on the revoked old token burned the new one too:
    // every session for this user is now dead. The user must log in again.
    const afterReuseAttempt = await refreshRepo.count({
      where: { userId: user.id, revokedAt: IsNull() },
    });
    expect(afterReuseAttempt).toBe(0);

    // Login with the OLD password now fails.
    await request(app.getHttpServer())
      .post('/v1/auth/login')
      .send({ identifier: EMAIL, password: PASSWORD })
      .expect(401);

    // Login with the NEW password works.
    await request(app.getHttpServer())
      .post('/v1/auth/login')
      .send({ identifier: EMAIL, password: NEW_PASSWORD })
      .expect(200);
  });

  it('returns 401 for a wrong current password without touching anything', async () => {
    await seedUser();
    const { access } = await loginPair();

    await request(app.getHttpServer())
      .post('/v1/users/me/password')
      .set('Authorization', `Bearer ${access}`)
      .send({ currentPassword: 'definitely wrong', newPassword: NEW_PASSWORD })
      .expect(401);

    // Original password still works.
    await request(app.getHttpServer())
      .post('/v1/auth/login')
      .send({ identifier: EMAIL, password: PASSWORD })
      .expect(200);
  });

  it('returns 400 when newPassword is shorter than 12 characters', async () => {
    await seedUser();
    const { access } = await loginPair();

    await request(app.getHttpServer())
      .post('/v1/users/me/password')
      .set('Authorization', `Bearer ${access}`)
      .send({ currentPassword: PASSWORD, newPassword: 'shorty' })
      .expect(400);
  });

  it('returns 400 when newPassword equals currentPassword', async () => {
    await seedUser();
    const { access } = await loginPair();

    await request(app.getHttpServer())
      .post('/v1/users/me/password')
      .set('Authorization', `Bearer ${access}`)
      .send({ currentPassword: PASSWORD, newPassword: PASSWORD })
      .expect(400);
  });
});
