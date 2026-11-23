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

const PASSWORD = 'correct horse battery staple';
const PREFIX = 'e2e_conc_';
const FIXTURES = [
  { username: `${PREFIX}a`, email: `${PREFIX}a@test.local` },
  { username: `${PREFIX}b`, email: `${PREFIX}b@test.local` },
];

// Minimal, deterministic deadlock-prevention test. Two admins target each
// other at the same instant; exactly one must win with 204, the other must
// lose with 409. A 500 anywhere means MySQL detected a deadlock and
// killed one — i.e. the lock-order invariant regressed.
describe('Admin concurrency (e2e) — mutual demotion of two admins', () => {
  let app: INestApplication;
  let usersRepo: Repository<User>;
  let refreshRepo: Repository<RefreshToken>;

  async function wipe() {
    const prior = await usersRepo.find({
      where: FIXTURES.flatMap((f) => [
        { emailAddress: f.email },
        { username: f.username },
      ]),
      withDeleted: true,
    });
    for (const row of prior) {
      await refreshRepo.delete({ userId: row.id });
      await usersRepo.delete({ id: row.id });
    }
  }

  async function seedAdmin(
    fx: { username: string; email: string },
  ): Promise<{ user: User; token: string }> {
    const hash = await argon2.hash(PASSWORD);
    const user = await usersRepo.save(
      usersRepo.create({
        username: fx.username,
        emailAddress: fx.email,
        firstName: 'A',
        lastName: 'A',
        passwordHash: hash,
        role: UserRole.ADMIN,
      }),
    );
    const res = await request(app.getHttpServer())
      .post('/v1/auth/login')
      .send({ identifier: fx.email, password: PASSWORD })
      .expect(200);
    return { user, token: res.body.accessToken };
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
    // Clean slate before each run so a prior admin row cannot inflate the
    // admin count and mask a last-admin collision.
    await usersRepo.delete({ role: UserRole.ADMIN });
    await wipe();
  });

  afterAll(async () => {
    await wipe();
    await app.close();
  });

  it('demoting each other concurrently: exactly one succeeds, the other gets 409, no 500, invariant holds', async () => {
    const A = await seedAdmin(FIXTURES[0]);
    const B = await seedAdmin(FIXTURES[1]);

    // Fire both requests at the same tick. Promise.all preserves order of
    // results but not of execution — both are already in flight before the
    // event loop moves to settle either.
    const [r1, r2] = await Promise.all([
      request(app.getHttpServer())
        .patch(`/v1/admin/users/${B.user.id}/role`)
        .set('Authorization', `Bearer ${A.token}`)
        .send({ role: UserRole.USER }),
      request(app.getHttpServer())
        .patch(`/v1/admin/users/${A.user.id}/role`)
        .set('Authorization', `Bearer ${B.token}`)
        .send({ role: UserRole.USER }),
    ]);

    const statuses = [r1.status, r2.status].sort((a, b) => a - b);

    // Allowed outcomes only. A 500 means MySQL killed one on deadlock.
    for (const s of statuses) {
      expect([200, 409]).toContain(s);
    }

    // Exactly one winner, exactly one blocked by the last-admin check.
    expect(statuses).toEqual([200, 409]);

    // Invariant: still exactly one active admin among A and B.
    const activeAdmins = await usersRepo.count({
      where: [
        { id: A.user.id, role: UserRole.ADMIN, deletedAt: IsNull() },
        { id: B.user.id, role: UserRole.ADMIN, deletedAt: IsNull() },
      ],
    });
    expect(activeAdmins).toBe(1);

    // Whichever admin got demoted had all their refresh tokens revoked.
    const demoted = (await usersRepo.find({
      where: [
        { id: A.user.id, role: UserRole.USER },
        { id: B.user.id, role: UserRole.USER },
      ],
    }))[0];
    expect(demoted).toBeDefined();
    const liveForDemoted = await refreshRepo.count({
      where: { userId: demoted.id, revokedAt: IsNull() },
    });
    expect(liveForDemoted).toBe(0);
  });
});
