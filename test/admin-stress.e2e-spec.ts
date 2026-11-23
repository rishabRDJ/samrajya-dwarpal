/* eslint-disable @typescript-eslint/no-explicit-any */
import type { INestApplication } from '@nestjs/common';
import type { In as InT, Not as NotT, Repository } from 'typeorm';
import type { RefreshToken } from '../src/auth/refresh-token.entity.js';
import type { User } from '../src/users/user.entity.js';

let Test: typeof import('@nestjs/testing').Test;
let getRepositoryToken: typeof import('@nestjs/typeorm').getRepositoryToken;
let request: any;
let In: typeof InT;
let Not: typeof NotT;
let IsNull: typeof import('typeorm').IsNull;
let RefreshTokenEntity: typeof import('../src/auth/refresh-token.entity.js').RefreshToken;
let UserEntity: typeof import('../src/users/user.entity.js').User;
let UserRole: typeof import('../src/users/user.entity.js').UserRole;
let TestAppModule: typeof import('./test-app.module.js').TestAppModule;
let setupApp: typeof import('../src/app.setup.js').setupApp;

const PASSWORD = 'correct horse battery staple';
const PREFIX = 'stress_';
const N = 10;

// --- small deterministic RNG + shuffle ----------------------------------
// Mulberry32 — a 32-bit integer in, a (0,1) float out. Good enough for
// shuffling test data and reproducible when a run fails: we log the seed,
// a rerun with the same seed replays the same interleaving choices.
function seededRandom(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(xs: readonly T[], rng: () => number): T[] {
  const out = [...xs];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// ------------------------------------------------------------------------

type Account = { id: string; username: string; accessToken: string };

describe('Admin concurrency stress (e2e) — 10 users, 2 random admins, mutual purge', () => {
  let app: INestApplication;
  let usersRepo: Repository<User>;
  let refreshRepo: Repository<RefreshToken>;

  async function wipe() {
    // Wipe every stress_* row. `In` on the username array is faster than
    // N individual lookups and also catches rows from prior failed runs.
    const names = Array.from({ length: N }, (_, i) => `${PREFIX}${i}`);
    const prior = await usersRepo.find({
      where: { username: In(names) },
      withDeleted: true,
    });
    for (const row of prior) {
      await refreshRepo.delete({ userId: row.id });
      await usersRepo.delete({ id: row.id });
    }
  }

  async function registerAndLogin(index: number): Promise<Account> {
    const username = `${PREFIX}${index}`;
    const email = `${username}@test.local`;

    const reg = await request(app.getHttpServer())
      .post('/v1/auth/register')
      .send({
        username,
        emailAddress: email,
        firstName: 'Stress',
        lastName: `User${index}`,
        password: PASSWORD,
      })
      .expect(201);

    const login = await request(app.getHttpServer())
      .post('/v1/auth/login')
      .send({ identifier: email, password: PASSWORD })
      .expect(200);

    return { id: reg.body.id, username, accessToken: login.body.accessToken };
  }

  beforeAll(async () => {
    ({ Test } = await import('@nestjs/testing'));
    ({ getRepositoryToken } = await import('@nestjs/typeorm'));
    const supertestMod = await import('supertest');
    request = (supertestMod as any).default ?? supertestMod;
    ({ In, Not, IsNull } = await import('typeorm'));
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

  // Jest's default timeout is tight for this one: 20 sequential deletes
  // inside two parallel loops, each hitting MySQL with real transactions.
  it(
    'two random admins each delete everyone else: exactly one admin survives, no 500s, deleted users have no live tokens',
    async () => {
      // 1. Create 10 users through the real /register + /login path.
      const users: Account[] = [];
      for (let i = 0; i < N; i++) users.push(await registerAndLogin(i));

      // 2. Pick two admins at random. Seed logged so a failure reproduces.
      const seed = Date.now();
      console.log(`[admin-stress] seed = ${seed}`);
      const rng = seededRandom(seed);
      const [adminA, adminB] = shuffle(users, rng).slice(0, 2);
      await usersRepo.update(
        { id: In([adminA.id, adminB.id]) },
        { role: UserRole.ADMIN },
      );

      // 3. Each admin deletes everyone else, one request at a time, in a
      //    private random order. The two loops run concurrently.
      const deleteAllOthers = async (admin: Account): Promise<number[]> => {
        const statuses: number[] = [];
        const order = shuffle(
          users.filter((u) => u.id !== admin.id),
          rng,
        );
        for (const target of order) {
          const res = await request(app.getHttpServer())
            .delete(`/v1/admin/users/${target.id}`)
            .set('Authorization', `Bearer ${admin.accessToken}`);
          statuses.push(res.status);
        }
        return statuses;
      };

      const [statusesA, statusesB] = await Promise.all([
        deleteAllOthers(adminA),
        deleteAllOthers(adminB),
      ]);

      // 4. Expected outcomes only. A 500 would mean a deadlock escaped.
      //    204 = deleted, 404 = someone else already deleted it,
      //    409 = would-be last-admin blocked, 401 = this admin was deleted
      //    by the other admin mid-loop so RolesGuard no longer sees them.
      for (const s of [...statusesA, ...statusesB]) {
        expect([204, 401, 404, 409]).toContain(s);
      }

      // 5. Invariants, read from the DB:
      //    - exactly ONE user among the 10 is still active
      //    - that user is an admin
      //    - the other NINE are soft-deleted
      //    - no deleted user has any live refresh token
      const ids = users.map((u) => u.id);

      const active = await usersRepo.find({ where: { id: In(ids) } });
      expect(active).toHaveLength(1);
      expect(active[0].role).toBe(UserRole.ADMIN);

      const deleted = await usersRepo.count({
        where: { id: In(ids), deletedAt: Not(IsNull()) },
        withDeleted: true,
      });
      expect(deleted).toBe(N - 1);

      const survivor = active[0].id;
      const liveTokensOfDeleted = await refreshRepo.count({
        where: {
          userId: In(ids.filter((id) => id !== survivor)),
          revokedAt: IsNull(),
        },
      });
      expect(liveTokensOfDeleted).toBe(0);
    },
    30_000,
  );
});
