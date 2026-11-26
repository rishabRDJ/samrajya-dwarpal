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
let FyersCredentialEntity: typeof import('../src/fyers/fyers-credential.entity.js').FyersCredential;
let FyersOauthStateEntity: typeof import('../src/fyers/fyers-oauth-state.entity.js').FyersOauthState;
let TestAppModule: typeof import('./test-app.module.js').TestAppModule;
let setupApp: typeof import('../src/app.setup.js').setupApp;
let FyersClient: typeof import('../src/fyers/fyers.client.js').FyersClient;
let hashState: typeof import('../src/fyers/fyers-auth.service.js').hashState;

const ADMIN_EMAIL = 'e2e-internal-admin@test.local';
const ADMIN_USERNAME = 'e2e_internal_admin';
const PASSWORD = 'correct horse battery staple';
const FAKE_TOKEN = 'fake-internal-token-xyz';

describe('Fyers internal endpoint (e2e)', () => {
  let app: INestApplication;
  let usersRepo: Repository<User>;
  let statesRepo: Repository<FyersOauthState>;
  let credsRepo: Repository<FyersCredential>;
  let systemKey: string;
  let fakeClient: { buildAuthUrl: jest.Mock; exchangeAuthCode: jest.Mock };

  async function wipe(): Promise<void> {
    await statesRepo.createQueryBuilder().delete().execute();
    await credsRepo.createQueryBuilder().delete().execute();
    const prior = await usersRepo.findOne({
      where: [{ emailAddress: ADMIN_EMAIL }, { username: ADMIN_USERNAME }],
      withDeleted: true,
    });
    if (prior) await usersRepo.delete({ id: prior.id });
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

  async function storeToken(admin: User, opts: { expired?: boolean } = {}) {
    // Round-trip through the real OAuth callback so the encrypted row is
    // written by production code paths, not directly inserted.
    const raw = 'internal-' + Date.now().toString(36);
    await statesRepo.insert({
      stateHash: hashState(raw),
      userId: admin.id,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    });
    await request(app.getHttpServer())
      .get('/v1/auth/fyers/callback')
      .query({ auth_code: 'c', state: raw })
      .expect(302);
    if (opts.expired) {
      await credsRepo.update(
        { singletonKey: 'active' },
        { expiresAt: new Date(Date.now() - 1000) },
      );
    }
  }

  beforeAll(async () => {
    ({ Test } = await import('@nestjs/testing'));
    ({ getRepositoryToken } = await import('@nestjs/typeorm'));
    argon2 = await import('argon2');
    const supertestMod = await import('supertest');
    request = (supertestMod as any).default ?? supertestMod;
    ({ User: UserEntity, UserRole } = await import('../src/users/user.entity.js'));
    ({ FyersCredential: FyersCredentialEntity } = await import(
      '../src/fyers/fyers-credential.entity.js'
    ));
    ({ FyersOauthState: FyersOauthStateEntity } = await import(
      '../src/fyers/fyers-oauth-state.entity.js'
    ));
    ({ TestAppModule } = await import('./test-app.module.js'));
    ({ setupApp } = await import('../src/app.setup.js'));
    ({ FyersClient } = await import('../src/fyers/fyers.client.js'));
    ({ hashState } = await import('../src/fyers/fyers-auth.service.js'));

    fakeClient = {
      buildAuthUrl: jest.fn((state: string) => `https://fake/?state=${state}`),
      exchangeAuthCode: jest.fn(async () => ({ accessToken: FAKE_TOKEN })),
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

    systemKey = process.env.SYSTEM_API_KEY as string;
    if (!systemKey) {
      throw new Error(
        'SYSTEM_API_KEY must be set in the test env; see README / CI config.',
      );
    }
  });

  beforeEach(async () => {
    await wipe();
    fakeClient.buildAuthUrl.mockClear();
    fakeClient.exchangeAuthCode.mockClear();
  });

  afterAll(async () => {
    await wipe();
    await app.close();
  });

  it('401 without x-system-key', async () => {
    await request(app.getHttpServer())
      .get('/v1/internal/fyers-token')
      .expect(401);
  });

  it('401 with a wrong (but same-length) x-system-key', async () => {
    const wrong = systemKey
      .split('')
      .reverse()
      .join('')
      .replace(/^./, (c) => (c === systemKey[0] ? (c === 'a' ? 'b' : 'a') : c));
    await request(app.getHttpServer())
      .get('/v1/internal/fyers-token')
      .set('x-system-key', wrong)
      .expect(401);
  });

  it('401 with a wrong-length x-system-key (no crash)', async () => {
    await request(app.getHttpServer())
      .get('/v1/internal/fyers-token')
      .set('x-system-key', 'ab'.repeat(16))
      .expect(401);
  });

  it('401 with only an admin bearer token (JWT alone is not accepted)', async () => {
    await seedAdmin();
    const res = await request(app.getHttpServer())
      .post('/v1/auth/login')
      .send({ identifier: ADMIN_EMAIL, password: PASSWORD })
      .expect(200);
    await request(app.getHttpServer())
      .get('/v1/internal/fyers-token')
      .set('Authorization', `Bearer ${res.body.accessToken}`)
      .expect(401);
  });

  it('404 FYERS_TOKEN_MISSING with a valid key before any login', async () => {
    const res = await request(app.getHttpServer())
      .get('/v1/internal/fyers-token')
      .set('x-system-key', systemKey)
      .expect(404);
    expect(res.body.code).toBe('FYERS_TOKEN_MISSING');
  });

  it('200 with decrypted token after a successful login', async () => {
    const admin = await seedAdmin();
    await storeToken(admin);

    const res = await request(app.getHttpServer())
      .get('/v1/internal/fyers-token')
      .set('x-system-key', systemKey)
      .expect(200);
    expect(res.body.accessToken).toBe(FAKE_TOKEN);
    expect(new Date(res.body.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it('410 FYERS_TOKEN_EXPIRED when the stored token has expired', async () => {
    const admin = await seedAdmin();
    await storeToken(admin, { expired: true });

    const res = await request(app.getHttpServer())
      .get('/v1/internal/fyers-token')
      .set('x-system-key', systemKey)
      .expect(410);
    expect(res.body.code).toBe('FYERS_TOKEN_EXPIRED');
  });
});
