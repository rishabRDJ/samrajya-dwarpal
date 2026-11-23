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

// Fixture usernames/emails are prefixed so the wipe() can find them all.
const ADMIN_A = { username: 'e2e_admin_a', email: 'e2e-admin-a@test.local' };
const ADMIN_B = { username: 'e2e_admin_b', email: 'e2e-admin-b@test.local' };
const USER_C = { username: 'e2e_admin_c', email: 'e2e-admin-c@test.local' };
const ALL_FIXTURES = [ADMIN_A, ADMIN_B, USER_C];

describe('Admin users (e2e)', () => {
  let app: INestApplication;
  let usersRepo: Repository<User>;
  let refreshRepo: Repository<RefreshToken>;

  async function wipe() {
    const prior = await usersRepo.find({
      where: ALL_FIXTURES.flatMap((f) => [
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

  async function seed(
    fx: { username: string; email: string },
    role: typeof UserRole.ADMIN | typeof UserRole.USER = UserRole.USER,
  ): Promise<User> {
    const hash = await argon2.hash(PASSWORD);
    return usersRepo.save(
      usersRepo.create({
        username: fx.username,
        emailAddress: fx.email,
        firstName: 'F',
        lastName: 'L',
        passwordHash: hash,
        role,
      }),
    );
  }

  async function tokenFor(fx: { email: string }): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/v1/auth/login')
      .send({ identifier: fx.email, password: PASSWORD })
      .expect(200);
    return res.body.accessToken;
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

  describe('GET /v1/admin/users', () => {
    it('returns 401 without a bearer token', async () => {
      await request(app.getHttpServer()).get('/v1/admin/users').expect(401);
    });

    it('returns 403 for a non-admin caller', async () => {
      await seed(USER_C, UserRole.USER);
      const token = await tokenFor(USER_C);
      await request(app.getHttpServer())
        .get('/v1/admin/users')
        .set('Authorization', `Bearer ${token}`)
        .expect(403);
    });

    it('returns paginated users for an admin, filtered to active by default', async () => {
      await seed(ADMIN_A, UserRole.ADMIN);
      await seed(USER_C, UserRole.USER);
      const token = await tokenFor(ADMIN_A);

      const res = await request(app.getHttpServer())
        .get('/v1/admin/users?limit=10')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body.data).toBeInstanceOf(Array);
      expect(res.body.total).toBeGreaterThanOrEqual(2);
      expect(res.body.page).toBe(1);
      expect(res.body.limit).toBe(10);
    });
  });

  describe('PATCH /v1/admin/users/:id/role', () => {
    it('returns 403 for a non-admin caller', async () => {
      const user = await seed(USER_C, UserRole.USER);
      const other = await seed(ADMIN_A, UserRole.ADMIN);
      const token = await tokenFor(USER_C);
      await request(app.getHttpServer())
        .patch(`/v1/admin/users/${other.id}/role`)
        .set('Authorization', `Bearer ${token}`)
        .send({ role: UserRole.USER })
        .expect(403);
      expect(user.id).toBeDefined();
    });

    it('returns 403 when an admin targets themselves (noSelfAdministration)', async () => {
      const admin = await seed(ADMIN_A, UserRole.ADMIN);
      const token = await tokenFor(ADMIN_A);
      await request(app.getHttpServer())
        .patch(`/v1/admin/users/${admin.id}/role`)
        .set('Authorization', `Bearer ${token}`)
        .send({ role: UserRole.USER })
        .expect(403);
    });

    it('promotes a regular user to admin', async () => {
      await seed(ADMIN_A, UserRole.ADMIN);
      const target = await seed(USER_C, UserRole.USER);
      const token = await tokenFor(ADMIN_A);

      const res = await request(app.getHttpServer())
        .patch(`/v1/admin/users/${target.id}/role`)
        .set('Authorization', `Bearer ${token}`)
        .send({ role: UserRole.ADMIN })
        .expect(200);
      expect(res.body.role).toBe(UserRole.ADMIN);

      const stored = await usersRepo.findOneBy({ id: target.id });
      expect(stored?.role).toBe(UserRole.ADMIN);
    });

    it('demotes an admin when another admin exists and revokes all target refresh tokens', async () => {
      const admin = await seed(ADMIN_A, UserRole.ADMIN);
      const demoteTarget = await seed(ADMIN_B, UserRole.ADMIN);
      // Give the target an active refresh token so we can verify the revoke.
      await tokenFor(ADMIN_B);
      const adminToken = await tokenFor(ADMIN_A);

      await request(app.getHttpServer())
        .patch(`/v1/admin/users/${demoteTarget.id}/role`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ role: UserRole.USER })
        .expect(200);

      const activeForTarget = await refreshRepo.count({
        where: { userId: demoteTarget.id, revokedAt: IsNull() },
      });
      expect(activeForTarget).toBe(0);

      const stored = await usersRepo.findOneBy({ id: demoteTarget.id });
      expect(stored?.role).toBe(UserRole.USER);
      expect(stored?.lastUpdatedBy).toBe(admin.id);
    });

    // Note: the "demote the last admin" invariant is NOT reachable via a
    // single HTTP request — the self-admin rule fires first whenever an
    // admin targets themselves, and targeting any other admin means
    // admins.length >= 2 at check time. The invariant is exercised by
    // the service unit test and by admin-concurrency.e2e-spec.ts, where
    // two parallel demotions genuinely leave only one admin and the
    // losing request sees count = 1 → 409.

    it('returns 404 for a non-existent target UUID', async () => {
      await seed(ADMIN_A, UserRole.ADMIN);
      const token = await tokenFor(ADMIN_A);
      await request(app.getHttpServer())
        .patch(`/v1/admin/users/00000000-0000-4000-8000-000000000000/role`)
        .set('Authorization', `Bearer ${token}`)
        .send({ role: UserRole.USER })
        .expect(404);
    });

    it('returns 400 for a malformed UUID in the path', async () => {
      await seed(ADMIN_A, UserRole.ADMIN);
      const token = await tokenFor(ADMIN_A);
      await request(app.getHttpServer())
        .patch(`/v1/admin/users/not-a-uuid/role`)
        .set('Authorization', `Bearer ${token}`)
        .send({ role: UserRole.USER })
        .expect(400);
    });
  });

  describe('DELETE /v1/admin/users/:id', () => {
    it('returns 403 when an admin deletes themselves', async () => {
      const admin = await seed(ADMIN_A, UserRole.ADMIN);
      const token = await tokenFor(ADMIN_A);
      await request(app.getHttpServer())
        .delete(`/v1/admin/users/${admin.id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(403);
    });

    it('soft-deletes a regular user and revokes every refresh token', async () => {
      await seed(ADMIN_A, UserRole.ADMIN);
      const target = await seed(USER_C, UserRole.USER);
      // Give the target a live refresh token so we can verify the revoke.
      await tokenFor(USER_C);
      const adminToken = await tokenFor(ADMIN_A);

      await request(app.getHttpServer())
        .delete(`/v1/admin/users/${target.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(204);

      const stored = await usersRepo.findOne({
        where: { id: target.id },
        withDeleted: true,
      });
      expect(stored?.deletedAt).not.toBeNull();

      const active = await refreshRepo.count({
        where: { userId: target.id, revokedAt: IsNull() },
      });
      expect(active).toBe(0);
    });

    it('returns 404 when the target is already soft-deleted', async () => {
      await seed(ADMIN_A, UserRole.ADMIN);
      const target = await seed(USER_C, UserRole.USER);
      await usersRepo.softDelete({ id: target.id });
      const adminToken = await tokenFor(ADMIN_A);

      await request(app.getHttpServer())
        .delete(`/v1/admin/users/${target.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(404);
    });
  });

  describe('PATCH /v1/admin/users/:id/restore', () => {
    it('restores a soft-deleted user', async () => {
      await seed(ADMIN_A, UserRole.ADMIN);
      const target = await seed(USER_C, UserRole.USER);
      await usersRepo.softDelete({ id: target.id });
      const adminToken = await tokenFor(ADMIN_A);

      const res = await request(app.getHttpServer())
        .patch(`/v1/admin/users/${target.id}/restore`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(res.body.id).toBe(target.id);

      const stored = await usersRepo.findOneBy({ id: target.id });
      expect(stored?.deletedAt).toBeNull();
    });

    it('returns 409 when the user is not actually deleted', async () => {
      await seed(ADMIN_A, UserRole.ADMIN);
      const target = await seed(USER_C, UserRole.USER);
      const adminToken = await tokenFor(ADMIN_A);
      await request(app.getHttpServer())
        .patch(`/v1/admin/users/${target.id}/restore`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(409);
    });

    it('returns 404 for a non-existent target UUID', async () => {
      await seed(ADMIN_A, UserRole.ADMIN);
      const adminToken = await tokenFor(ADMIN_A);
      await request(app.getHttpServer())
        .patch('/v1/admin/users/00000000-0000-4000-8000-000000000000/restore')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(404);
    });
  });
});
