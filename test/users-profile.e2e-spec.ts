/* eslint-disable @typescript-eslint/no-explicit-any */
import type { INestApplication } from '@nestjs/common';
import type { Repository } from 'typeorm';
import type { RefreshToken } from '../src/auth/refresh-token.entity.js';
import type { User } from '../src/users/user.entity.js';

let Test: typeof import('@nestjs/testing').Test;
let getRepositoryToken: typeof import('@nestjs/typeorm').getRepositoryToken;
let argon2: typeof import('argon2');
let request: any;
let RefreshTokenEntity: typeof import('../src/auth/refresh-token.entity.js').RefreshToken;
let UserEntity: typeof import('../src/users/user.entity.js').User;
let UserRole: typeof import('../src/users/user.entity.js').UserRole;
let TestAppModule: typeof import('./test-app.module.js').TestAppModule;
let setupApp: typeof import('../src/app.setup.js').setupApp;

const EMAIL = 'e2e-profile@test.local';
const USERNAME = 'e2e_profile_user';
const PASSWORD = 'correct horse battery staple';

const OTHER_EMAIL = 'e2e-profile-other@test.local';
const OTHER_USERNAME = 'e2e_profile_other';

describe('Users profile (e2e)', () => {
  let app: INestApplication;
  let usersRepo: Repository<User>;
  let refreshRepo: Repository<RefreshToken>;

  async function wipe() {
    const prior = await usersRepo.find({
      where: [
        { emailAddress: EMAIL },
        { username: USERNAME },
        { emailAddress: OTHER_EMAIL },
        { username: OTHER_USERNAME },
      ],
      withDeleted: true,
    });
    for (const row of prior) {
      await refreshRepo.delete({ userId: row.id });
      await usersRepo.delete({ id: row.id });
    }
  }

  async function seedUser(overrides: Partial<User> = {}): Promise<User> {
    const hash = await argon2.hash(PASSWORD);
    return usersRepo.save(
      usersRepo.create({
        username: USERNAME,
        emailAddress: EMAIL,
        firstName: 'Original',
        lastName: 'Name',
        phoneNumber: null,
        passwordHash: hash,
        role: UserRole.USER,
        ...overrides,
      }),
    );
  }

  async function login(): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/v1/auth/login')
      .send({ identifier: EMAIL, password: PASSWORD })
      .expect(200);
    return res.body.accessToken;
  }

  beforeAll(async () => {
    ({ Test } = await import('@nestjs/testing'));
    ({ getRepositoryToken } = await import('@nestjs/typeorm'));
    argon2 = await import('argon2');
    const supertestMod = await import('supertest');
    request = (supertestMod as any).default ?? supertestMod;
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

  describe('GET /v1/users/me', () => {
    it('returns 401 without a bearer token', async () => {
      await request(app.getHttpServer()).get('/v1/users/me').expect(401);
    });

    it('returns the full profile for an authenticated user', async () => {
      await seedUser();
      const token = await login();
      const res = await request(app.getHttpServer())
        .get('/v1/users/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(res.body.username).toBe(USERNAME);
      expect(res.body.emailAddress).toBe(EMAIL);
      expect(res.body.firstName).toBe('Original');
      expect(res.body.role).toBe(UserRole.USER);
      // Sensitive fields never leave the server.
      expect(res.body.passwordHash).toBeUndefined();
      expect(res.body.deletedAt).toBeUndefined();
      expect(res.body.lastUpdatedBy).toBeUndefined();
    });
  });

  describe('PATCH /v1/users/me', () => {
    it('updates firstName and persists it in the DB', async () => {
      const user = await seedUser();
      const token = await login();

      const res = await request(app.getHttpServer())
        .patch('/v1/users/me')
        .set('Authorization', `Bearer ${token}`)
        .send({ firstName: 'Changed' })
        .expect(200);

      expect(res.body.firstName).toBe('Changed');
      const stored = await usersRepo.findOneBy({ id: user.id });
      expect(stored?.firstName).toBe('Changed');
      // lastUpdatedBy should be stamped to the acting user.
      expect(stored?.lastUpdatedBy).toBe(user.id);
    });

    it('rejects an empty body with 400 (at least one field required)', async () => {
      await seedUser();
      const token = await login();
      await request(app.getHttpServer())
        .patch('/v1/users/me')
        .set('Authorization', `Bearer ${token}`)
        .send({})
        .expect(400);
    });

    it('rejects a role injection with 400 (forbidNonWhitelisted)', async () => {
      await seedUser();
      const token = await login();
      await request(app.getHttpServer())
        .patch('/v1/users/me')
        .set('Authorization', `Bearer ${token}`)
        .send({ firstName: 'X', role: UserRole.ADMIN })
        .expect(400);
    });

    it('rejects an invalid phone number with 400', async () => {
      await seedUser();
      const token = await login();
      await request(app.getHttpServer())
        .patch('/v1/users/me')
        .set('Authorization', `Bearer ${token}`)
        .send({ phoneNumber: '919876543210' }) // missing leading +
        .expect(400);
    });

    it('accepts null phoneNumber to clear the stored value', async () => {
      const user = await seedUser({ phoneNumber: '+919876543210' });
      const token = await login();

      await request(app.getHttpServer())
        .patch('/v1/users/me')
        .set('Authorization', `Bearer ${token}`)
        .send({ phoneNumber: null })
        .expect(200);

      const stored = await usersRepo.findOneBy({ id: user.id });
      expect(stored?.phoneNumber).toBeNull();
    });

    it('returns 409 when the phone number is already held by another user', async () => {
      await seedUser();
      // Seed a second user holding the number we're going to try.
      const otherHash = await argon2.hash(PASSWORD);
      await usersRepo.save(
        usersRepo.create({
          username: OTHER_USERNAME,
          emailAddress: OTHER_EMAIL,
          firstName: 'Other',
          lastName: 'User',
          phoneNumber: '+919876543210',
          passwordHash: otherHash,
          role: UserRole.USER,
        }),
      );
      const token = await login();

      await request(app.getHttpServer())
        .patch('/v1/users/me')
        .set('Authorization', `Bearer ${token}`)
        .send({ phoneNumber: '+919876543210' })
        .expect(409);
    });
  });
});
