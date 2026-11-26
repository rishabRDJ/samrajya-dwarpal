/* eslint-disable @typescript-eslint/no-explicit-any */
import { jest } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import type { Repository } from 'typeorm';
import type { User } from '../src/users/user.entity.js';
import type { FyersCredential } from '../src/fyers/fyers-credential.entity.js';
import type { FyersOauthState } from '../src/fyers/fyers-oauth-state.entity.js';

let Test: typeof import('@nestjs/testing').Test;
let getRepositoryToken: typeof import('@nestjs/typeorm').getRepositoryToken;
let argon2: typeof import('argon2');
let request: any;
let UserEntity: typeof import('../src/users/user.entity.js').User;
let UserRole: typeof import('../src/users/user.entity.js').UserRole;
let FyersOauthStateEntity: typeof import('../src/fyers/fyers-oauth-state.entity.js').FyersOauthState;
let FyersCredentialEntity: typeof import('../src/fyers/fyers-credential.entity.js').FyersCredential;
let TestAppModule: typeof import('./test-app.module.js').TestAppModule;
let setupApp: typeof import('../src/app.setup.js').setupApp;
let FyersClient: typeof import('../src/fyers/fyers.client.js').FyersClient;
let hashState: typeof import('../src/fyers/fyers-auth.service.js').hashState;

const ADMIN_EMAIL = 'e2e-fyers-admin@test.local';
const ADMIN_USERNAME = 'e2e_fyers_admin';
const USER_EMAIL = 'e2e-fyers-user@test.local';
const USER_USERNAME = 'e2e_fyers_user';
const PASSWORD = 'correct horse battery staple';

const FAKE_ACCESS_TOKEN = 'fake-fyers-access-token-123';

describe('Fyers OAuth (e2e)', () => {
  let app: INestApplication;
  let usersRepo: Repository<User>;
  let statesRepo: Repository<FyersOauthState>;
  let credsRepo: Repository<FyersCredential>;
  let fakeClient: {
    buildAuthUrl: jest.Mock;
    exchangeAuthCode: jest.Mock;
  };

  async function wipeUsers(): Promise<void> {
    const emails = [ADMIN_EMAIL, USER_EMAIL];
    const usernames = [ADMIN_USERNAME, USER_USERNAME];
    const prior = await usersRepo.find({
      where: [
        ...emails.map((e) => ({ emailAddress: e })),
        ...usernames.map((u) => ({ username: u })),
      ],
      withDeleted: true,
    });
    for (const u of prior) {
      await statesRepo.delete({ userId: u.id });
      await usersRepo.delete({ id: u.id });
    }
  }

  async function wipeFyers(): Promise<void> {
    await statesRepo.createQueryBuilder().delete().execute();
    await credsRepo.createQueryBuilder().delete().execute();
  }

  async function seedAdmin(): Promise<User> {
    const hash = await argon2.hash(PASSWORD);
    return usersRepo.save(
      usersRepo.create({
        username: ADMIN_USERNAME,
        emailAddress: ADMIN_EMAIL,
        firstName: 'A',
        lastName: 'A',
        passwordHash: hash,
        role: UserRole.ADMIN,
      }),
    );
  }

  async function seedUser(): Promise<User> {
    const hash = await argon2.hash(PASSWORD);
    return usersRepo.save(
      usersRepo.create({
        username: USER_USERNAME,
        emailAddress: USER_EMAIL,
        firstName: 'U',
        lastName: 'U',
        passwordHash: hash,
        role: UserRole.USER,
      }),
    );
  }

  async function loginAs(email: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/v1/auth/login')
      .send({ identifier: email, password: PASSWORD })
      .expect(200);
    return res.body.accessToken as string;
  }

  beforeAll(async () => {
    ({ Test } = await import('@nestjs/testing'));
    ({ getRepositoryToken } = await import('@nestjs/typeorm'));
    argon2 = await import('argon2');
    const supertestMod = await import('supertest');
    request = (supertestMod as any).default ?? supertestMod;
    ({ User: UserEntity, UserRole } = await import('../src/users/user.entity.js'));
    ({ FyersOauthState: FyersOauthStateEntity } = await import(
      '../src/fyers/fyers-oauth-state.entity.js'
    ));
    ({ FyersCredential: FyersCredentialEntity } = await import(
      '../src/fyers/fyers-credential.entity.js'
    ));
    ({ TestAppModule } = await import('./test-app.module.js'));
    ({ setupApp } = await import('../src/app.setup.js'));
    ({ FyersClient } = await import('../src/fyers/fyers.client.js'));
    ({ hashState } = await import('../src/fyers/fyers-auth.service.js'));

    fakeClient = {
      buildAuthUrl: jest.fn(
        (state: string) => `https://fyers.fake/auth?state=${state}`,
      ),
      exchangeAuthCode: jest.fn(async () => ({
        accessToken: FAKE_ACCESS_TOKEN,
      })),
    };

    const moduleRef = await Test.createTestingModule({
      imports: [TestAppModule],
    })
      .overrideProvider(FyersClient)
      .useValue(fakeClient)
      .compile();

    app = moduleRef.createNestApplication();
    setupApp(app);
    await app.init();

    usersRepo = moduleRef.get(getRepositoryToken(UserEntity));
    statesRepo = moduleRef.get(getRepositoryToken(FyersOauthStateEntity));
    credsRepo = moduleRef.get(getRepositoryToken(FyersCredentialEntity));
  });

  beforeEach(async () => {
    await wipeFyers();
    await wipeUsers();
    fakeClient.buildAuthUrl.mockClear();
    fakeClient.exchangeAuthCode.mockClear();
  });

  afterAll(async () => {
    await wipeFyers();
    await wipeUsers();
    await app.close();
  });

  describe('GET /v1/auth/fyers/login-url', () => {
    it('as admin: returns a Fyers URL containing a state and stores its hash', async () => {
      await seedAdmin();
      const token = await loginAs(ADMIN_EMAIL);

      const res = await request(app.getHttpServer())
        .get('/v1/auth/fyers/login-url')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body.url).toMatch(/state=/);
      const url = new URL(res.body.url);
      const rawState = url.searchParams.get('state')!;

      const stored = await statesRepo.findOneBy({ stateHash: hashState(rawState) });
      expect(stored).toBeTruthy();
      expect(stored!.usedAt).toBeNull();
    });

    it('as a normal user: 403', async () => {
      await seedUser();
      const token = await loginAs(USER_EMAIL);
      await request(app.getHttpServer())
        .get('/v1/auth/fyers/login-url')
        .set('Authorization', `Bearer ${token}`)
        .expect(403);
    });

    it('without bearer: 401', async () => {
      await request(app.getHttpServer())
        .get('/v1/auth/fyers/login-url')
        .expect(401);
    });
  });

  describe('GET /v1/auth/fyers/callback', () => {
    async function mintState(user: User): Promise<string> {
      const raw = Math.random().toString(36).slice(2) + Date.now().toString(36);
      await statesRepo.insert({
        stateHash: hashState(raw),
        userId: user.id,
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      });
      return raw;
    }

    it('valid state: 302 to status=connected and stores an encrypted row', async () => {
      const admin = await seedAdmin();
      const raw = await mintState(admin);

      const res = await request(app.getHttpServer())
        .get('/v1/auth/fyers/callback')
        .query({ auth_code: 'the-code', state: raw })
        .expect(302);

      expect(res.header.location).toContain('/dashboard');
      expect(res.header.location).toContain('status=connected');

      const cred = await credsRepo.findOneBy({ singletonKey: 'active' });
      expect(cred).toBeTruthy();
      expect(cred!.encryptedToken).not.toBe(FAKE_ACCESS_TOKEN);
      expect(cred!.keyVersion).toBe(1);
      expect(cred!.connectedByUserId).toBe(admin.id);
    });

    it('the SAME state used twice: second callback redirects to reason=invalid_state', async () => {
      const admin = await seedAdmin();
      const raw = await mintState(admin);

      await request(app.getHttpServer())
        .get('/v1/auth/fyers/callback')
        .query({ auth_code: 'c', state: raw })
        .expect(302);

      const second = await request(app.getHttpServer())
        .get('/v1/auth/fyers/callback')
        .query({ auth_code: 'c', state: raw })
        .expect(302);
      expect(second.header.location).toContain('reason=invalid_state');
    });

    it('expired state: redirects to reason=invalid_state', async () => {
      const admin = await seedAdmin();
      const raw = 'expired-raw-' + Date.now();
      await statesRepo.insert({
        stateHash: hashState(raw),
        userId: admin.id,
        expiresAt: new Date(Date.now() - 1000),
      });
      const res = await request(app.getHttpServer())
        .get('/v1/auth/fyers/callback')
        .query({ auth_code: 'c', state: raw })
        .expect(302);
      expect(res.header.location).toContain('reason=invalid_state');
    });

    it('fyers error signal (s=error): redirects to reason=denied', async () => {
      const res = await request(app.getHttpServer())
        .get('/v1/auth/fyers/callback')
        .query({ s: 'error', message: 'user denied' })
        .expect(302);
      expect(res.header.location).toContain('reason=denied');
    });

    it('Fyers exchange fails: redirects to reason=fyers_error', async () => {
      const admin = await seedAdmin();
      const raw = await mintState(admin);
      fakeClient.exchangeAuthCode.mockRejectedValueOnce(
        new Error('Fyers 500'),
      );

      const res = await request(app.getHttpServer())
        .get('/v1/auth/fyers/callback')
        .query({ auth_code: 'c', state: raw })
        .expect(302);
      expect(res.header.location).toContain('reason=fyers_error');
    });
  });

  describe('GET /v1/auth/fyers/status', () => {
    it('reports connected=true with expiresAt after a successful callback', async () => {
      const admin = await seedAdmin();
      const token = await loginAs(ADMIN_EMAIL);

      const urlRes = await request(app.getHttpServer())
        .get('/v1/auth/fyers/login-url')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      const rawState = new URL(urlRes.body.url).searchParams.get('state')!;

      await request(app.getHttpServer())
        .get('/v1/auth/fyers/callback')
        .query({ auth_code: 'c', state: rawState })
        .expect(302);

      const status = await request(app.getHttpServer())
        .get('/v1/auth/fyers/status')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(status.body.connected).toBe(true);
      expect(status.body.expiresAt).toBeDefined();
      expect(status.body.connectedByUserId).toBe(admin.id);
      expect(JSON.stringify(status.body)).not.toContain(FAKE_ACCESS_TOKEN);
    });

    it('reports connected=false when nothing has been stored', async () => {
      await seedAdmin();
      const token = await loginAs(ADMIN_EMAIL);
      const res = await request(app.getHttpServer())
        .get('/v1/auth/fyers/status')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(res.body).toEqual({
        connected: false,
        expiresAt: null,
        connectedByUserId: null,
        updatedAt: null,
      });
    });
  });
});
