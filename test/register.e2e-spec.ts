/* eslint-disable @typescript-eslint/no-explicit-any */
import type { INestApplication } from '@nestjs/common';
import type { Repository } from 'typeorm';
import type { User } from '../src/users/user.entity.js';

// Runtime bindings assigned in beforeAll — same pattern as auth.e2e-spec.ts
// so the throttler mock is in place before any module loads.
let Test: typeof import('@nestjs/testing').Test;
let getRepositoryToken: typeof import('@nestjs/typeorm').getRepositoryToken;
let request: any;
let UserEntity: typeof import('../src/users/user.entity.js').User;
let TestAppModule: typeof import('./test-app.module.js').TestAppModule;
let setupApp: typeof import('../src/app.setup.js').setupApp;

const USERNAME = 'rishab_e2e';
const EMAIL = 'rishab.e2e@test.local';
const PASSWORD = 'correct horse battery staple';

function body(overrides: Record<string, unknown> = {}) {
  return {
    username: USERNAME,
    emailAddress: EMAIL,
    firstName: 'Rishab',
    lastName: 'Jaiswal',
    password: PASSWORD,
    ...overrides,
  };
}

describe('Register + Availability (e2e)', () => {
  let app: INestApplication;
  let usersRepo: Repository<User>;

  async function wipe() {
    // Identifier collisions across tests: delete anything matching our test
    // namespace, including soft-deleted rows (withDeleted scoping).
    await usersRepo
      .createQueryBuilder()
      .delete()
      .where('username LIKE :user OR emailAddress LIKE :email', {
        user: '%_e2e%',
        email: '%.e2e@test.local',
      })
      .execute();
  }

  beforeAll(async () => {
    ({ Test } = await import('@nestjs/testing'));
    ({ getRepositoryToken } = await import('@nestjs/typeorm'));
    const supertestMod = await import('supertest');
    request = (supertestMod as any).default ?? supertestMod;
    ({ User: UserEntity } = await import('../src/users/user.entity.js'));
    ({ TestAppModule } = await import('./test-app.module.js'));
    ({ setupApp } = await import('../src/app.setup.js'));

    const moduleRef = await Test.createTestingModule({
      imports: [TestAppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    setupApp(app);
    await app.init();

    usersRepo = moduleRef.get(getRepositoryToken(UserEntity));
  });

  beforeEach(async () => {
    await wipe();
  });

  afterAll(async () => {
    await wipe();
    await app.close();
  });

  describe('POST /v1/auth/register', () => {
    it('creates a user and returns a UserResponseDto without passwordHash', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/auth/register')
        .send(body())
        .expect(201);

      expect(res.body.id).toBeDefined();
      expect(res.body.username).toBe(USERNAME);
      expect(res.body.emailAddress).toBe(EMAIL);
      expect(res.body.role).toBe('user');
      expect(res.body).not.toHaveProperty('passwordHash');
      expect(res.body).not.toHaveProperty('deletedAt');
    });

    it('lowercases username and email on store (case-insensitive canonical form)', async () => {
      await request(app.getHttpServer())
        .post('/v1/auth/register')
        .send(
          body({
            username: 'Rishab_E2E',
            emailAddress: 'RISHAB.E2E@Test.Local',
          }),
        )
        .expect(201);

      const row = await usersRepo.findOne({ where: { username: USERNAME } });
      expect(row?.username).toBe(USERNAME);
      expect(row?.emailAddress).toBe(EMAIL);
    });

    it('409s on duplicate username with conflictField username', async () => {
      await request(app.getHttpServer())
        .post('/v1/auth/register')
        .send(body())
        .expect(201);
      const res = await request(app.getHttpServer())
        .post('/v1/auth/register')
        .send(
          body({
            username: USERNAME.toUpperCase(),
            emailAddress: 'other.e2e@test.local',
          }),
        )
        .expect(409);
      expect(res.body.conflictField).toBe('username');
      expect(res.body.message).toBe('username already in use');
    });

    it('409s on duplicate email with conflictField emailAddress', async () => {
      await request(app.getHttpServer())
        .post('/v1/auth/register')
        .send(body())
        .expect(201);
      const res = await request(app.getHttpServer())
        .post('/v1/auth/register')
        .send(body({ username: 'otheruser_e2e' }))
        .expect(409);
      expect(res.body.conflictField).toBe('emailAddress');
      expect(res.body.message).toBe('emailAddress already in use');
    });

    it('409s on duplicate phoneNumber with conflictField phoneNumber', async () => {
      await request(app.getHttpServer())
        .post('/v1/auth/register')
        .send(body({ phoneNumber: '9876543210' }))
        .expect(201);
      const res = await request(app.getHttpServer())
        .post('/v1/auth/register')
        .send(
          body({
            username: 'otheruser_phone_e2e',
            emailAddress: 'other.phone.e2e@test.local',
            phoneNumber: '9876543210',
          }),
        )
        .expect(409);
      expect(res.body.conflictField).toBe('phoneNumber');
      expect(res.body.message).toBe('phoneNumber already in use');
    });

    it('400s when username contains @', async () => {
      await request(app.getHttpServer())
        .post('/v1/auth/register')
        .send(body({ username: 'bad@name' }))
        .expect(400);
    });

    it('400s when password is too short', async () => {
      await request(app.getHttpServer())
        .post('/v1/auth/register')
        .send(body({ password: 'short' }))
        .expect(400);
    });

    it('400s on unknown fields (whitelist is strict)', async () => {
      await request(app.getHttpServer())
        .post('/v1/auth/register')
        .send({ ...body(), role: 'admin' })
        .expect(400);
    });

    it('accepts a 10-digit Indian mobile phoneNumber', async () => {
      await request(app.getHttpServer())
        .post('/v1/auth/register')
        .send(body({ phoneNumber: '9876543210' }))
        .expect(201);
    });

    it('400s when phoneNumber is an E.164 value with country code', async () => {
      await request(app.getHttpServer())
        .post('/v1/auth/register')
        .send(body({ phoneNumber: '+919876543210' }))
        .expect(400);
    });

    it('400s when phoneNumber starts with a non-mobile prefix (5)', async () => {
      await request(app.getHttpServer())
        .post('/v1/auth/register')
        .send(body({ phoneNumber: '5876543210' }))
        .expect(400);
    });

    it('400s when phoneNumber is too short', async () => {
      await request(app.getHttpServer())
        .post('/v1/auth/register')
        .send(body({ phoneNumber: '987654321' }))
        .expect(400);
    });

    it('400s when phoneNumber has embedded whitespace', async () => {
      await request(app.getHttpServer())
        .post('/v1/auth/register')
        .send(body({ phoneNumber: '98765 43210' }))
        .expect(400);
    });
  });

  describe('GET /v1/auth/availability', () => {
    it('returns true for a fresh username', async () => {
      const res = await request(app.getHttpServer())
        .get('/v1/auth/availability')
        .query({ username: 'never_seen_e2e' })
        .expect(200);
      expect(res.body).toEqual({ available: true });
    });

    it('returns false for a taken username', async () => {
      await request(app.getHttpServer())
        .post('/v1/auth/register')
        .send(body())
        .expect(201);
      const res = await request(app.getHttpServer())
        .get('/v1/auth/availability')
        .query({ username: USERNAME })
        .expect(200);
      expect(res.body).toEqual({ available: false });
    });

    it('is case-insensitive: a taken username is unavailable in any case', async () => {
      await request(app.getHttpServer())
        .post('/v1/auth/register')
        .send(body())
        .expect(201);
      const res = await request(app.getHttpServer())
        .get('/v1/auth/availability')
        .query({ username: USERNAME.toUpperCase() })
        .expect(200);
      expect(res.body.available).toBe(false);
    });

    it('returns false for a taken email', async () => {
      await request(app.getHttpServer())
        .post('/v1/auth/register')
        .send(body())
        .expect(201);
      const res = await request(app.getHttpServer())
        .get('/v1/auth/availability')
        .query({ emailAddress: EMAIL })
        .expect(200);
      expect(res.body.available).toBe(false);
    });

    it('400s when neither field is provided', async () => {
      await request(app.getHttpServer())
        .get('/v1/auth/availability')
        .expect(400);
    });

    it('400s when the username is malformed', async () => {
      await request(app.getHttpServer())
        .get('/v1/auth/availability')
        .query({ username: 'bad@name' })
        .expect(400);
    });

    it('soft-deleted users still hold their username (reserved)', async () => {
      const reg = await request(app.getHttpServer())
        .post('/v1/auth/register')
        .send(body())
        .expect(201);
      await usersRepo.softDelete({ id: reg.body.id });

      const res = await request(app.getHttpServer())
        .get('/v1/auth/availability')
        .query({ username: USERNAME })
        .expect(200);
      expect(res.body.available).toBe(false);
    });
  });
});
