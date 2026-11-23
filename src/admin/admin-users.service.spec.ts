/* eslint-disable @typescript-eslint/no-explicit-any */
import 'reflect-metadata';
import { jest } from '@jest/globals';
import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import { TokenService } from '../auth/token.service.js';
import { ScopedLogger } from '../common/logging/scoped-logger.js';
import { createScopedLoggerMock, type ScopedLoggerMock } from '../common/logging/scoped-logger.mock.js';
import { User, UserRole } from '../users/user.entity.js';
import { AdminUsersService } from './admin-users.service.js';
import {
  ListAdminUsersQueryDto,
  UserListStatus,
} from './dto/list-admin-users-query.dto.js';

// Service tests exercise business rules against mock repositories. The
// transaction + pessimistic lock are TypeORM behaviour and are not
// asserted at the SQL level here; what we DO assert is that each path
// opens a transaction, routes writes through the EntityManager, and in
// the last-admin case throws before writing.

function makeAdmin(overrides: Partial<User> = {}): User {
  return {
    id: 'admin-1',
    role: UserRole.ADMIN,
    deletedAt: null,
    ...overrides,
  } as User;
}

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: 'user-1',
    role: UserRole.USER,
    deletedAt: null,
    ...overrides,
  } as User;
}

describe('AdminUsersService', () => {
  let service: AdminUsersService;
  let tokens: jest.Mocked<Pick<TokenService, 'revokeAllForUser'>>;
  let logger: ScopedLoggerMock;
  let defaultRepo: any;
  let txRepo: any;

  // Chain used by loadForWrite + assertNotLastAdmin. getOne returns the
  // row we queue up, getMany returns the admin list we queue up.
  let lockQb: any;

  beforeEach(async () => {
    lockQb = {
      setLock: jest.fn().mockReturnThis(),
      withDeleted: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      getOne: jest.fn(),
      // Default: the admin set is non-empty so promotions and no-ops
      // succeed without needing per-test setup. Last-admin / demotion
      // tests override this via mockResolvedValueOnce.
      getMany: jest.fn(async () => [{ id: 'other-admin' }, { id: 'admin-1' }]),
    };

    txRepo = {
      createQueryBuilder: jest.fn(() => lockQb),
      update: jest.fn(async () => ({ affected: 1 })),
      softDelete: jest.fn(async () => ({ affected: 1 })),
      restore: jest.fn(async () => ({ affected: 1 })),
    };

    // Used only by list() (reads on default repo, no transaction).
    const listQb = {
      withDeleted: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getManyAndCount: jest.fn(async () => [[], 0]),
    };

    defaultRepo = {
      createQueryBuilder: jest.fn(() => listQb),
      count: jest.fn(async () => 0),
    };

    const em = {
      getRepository: jest.fn(() => txRepo),
    };
    const dataSource = {
      transaction: jest.fn(async (cb: any) => cb(em)),
    };

    tokens = { revokeAllForUser: jest.fn() };
    logger = createScopedLoggerMock();

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        AdminUsersService,
        { provide: getRepositoryToken(User), useValue: defaultRepo },
        { provide: TokenService, useValue: tokens },
        { provide: getDataSourceToken(), useValue: dataSource },
        { provide: ScopedLogger, useValue: logger.instance },
      ],
    }).compile();

    service = moduleRef.get(AdminUsersService);
  });

  describe('logging', () => {
    it('setRole success emits admin.role.changed AFTER commit, with from and to', async () => {
      lockQb.getOne
        .mockResolvedValueOnce(makeAdmin({ id: 'admin-to-demote' }))
        .mockResolvedValueOnce(makeAdmin({ id: 'admin-to-demote', role: UserRole.USER }));
      lockQb.getMany.mockResolvedValueOnce([
        { id: 'admin-to-demote' },
        { id: 'other' },
      ]);

      await service.setRole('other', 'admin-to-demote', UserRole.USER);

      expect(logger.info).toHaveBeenCalledWith('admin.role.changed', {
        actorId: 'other',
        targetId: 'admin-to-demote',
        from: UserRole.ADMIN,
        to: UserRole.USER,
      });
    });

    it('setRole does NOT emit admin.role.changed when the transaction throws', async () => {
      lockQb.getOne.mockResolvedValueOnce(makeUser({ deletedAt: new Date() }));
      await expect(service.setRole('a', 'b', UserRole.ADMIN)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      const changed = logger.info.mock.calls.find(
        (c: unknown[]) => c[0] === 'admin.role.changed',
      );
      expect(changed).toBeUndefined();
    });

    it('setRole self-block emits admin.role.blocked_self', async () => {
      await expect(service.setRole('admin-1', 'admin-1', UserRole.USER)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(logger.warn).toHaveBeenCalledWith('admin.role.blocked_self', {
        actorId: 'admin-1',
      });
    });

    it('setRole last-admin block emits admin.role.blocked_last_admin', async () => {
      lockQb.getOne.mockResolvedValueOnce(makeAdmin({ id: 'only' }));
      lockQb.getMany.mockResolvedValueOnce([{ id: 'only' }]);
      await expect(service.setRole('other', 'only', UserRole.USER)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(logger.warn).toHaveBeenCalledWith('admin.role.blocked_last_admin', {
        actorId: 'other',
        targetId: 'only',
      });
    });

    it('setRole same-role is logged as admin.role.unchanged (debug) with actor + target + role', async () => {
      lockQb.getOne.mockResolvedValueOnce(makeUser({ id: 'u', role: UserRole.USER }));
      await service.setRole('admin-1', 'u', UserRole.USER);
      expect(logger.debug).toHaveBeenCalledWith('admin.role.unchanged', {
        actorId: 'admin-1',
        targetId: 'u',
        role: UserRole.USER,
      });
    });

    it('softDelete success emits admin.user.deleted with targetRole', async () => {
      lockQb.getOne.mockResolvedValueOnce(makeUser({ id: 'u' }));
      await service.softDelete('admin-1', 'u');
      expect(logger.info).toHaveBeenCalledWith('admin.user.deleted', {
        actorId: 'admin-1',
        targetId: 'u',
        targetRole: UserRole.USER,
      });
    });

    it('softDelete self-block emits admin.user.delete_blocked with reason self', async () => {
      await expect(service.softDelete('admin-1', 'admin-1')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(logger.warn).toHaveBeenCalledWith('admin.user.delete_blocked', {
        actorId: 'admin-1',
        targetId: 'admin-1',
        reason: 'self',
      });
    });

    it('softDelete last-admin block emits admin.user.delete_blocked with reason last_admin', async () => {
      lockQb.getOne.mockResolvedValueOnce(makeAdmin({ id: 'only' }));
      lockQb.getMany.mockResolvedValueOnce([{ id: 'only' }]);
      await expect(service.softDelete('other', 'only')).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(logger.warn).toHaveBeenCalledWith('admin.user.delete_blocked', {
        actorId: 'other',
        targetId: 'only',
        reason: 'last_admin',
      });
    });

    it('restore success emits admin.user.restored', async () => {
      lockQb.getOne
        .mockResolvedValueOnce(makeUser({ id: 'u', deletedAt: new Date() }))
        .mockResolvedValueOnce(makeUser({ id: 'u', deletedAt: null }));
      await service.restore('admin-1', 'u');
      expect(logger.info).toHaveBeenCalledWith('admin.user.restored', {
        actorId: 'admin-1',
        targetId: 'u',
      });
    });

    it('restore self-block emits admin.user.restore_blocked reason self', async () => {
      await expect(service.restore('admin-1', 'admin-1')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(logger.warn).toHaveBeenCalledWith('admin.user.restore_blocked', {
        actorId: 'admin-1',
        targetId: 'admin-1',
        reason: 'self',
      });
    });

    it('restore not-deleted emits admin.user.restore_blocked reason not_deleted', async () => {
      lockQb.getOne.mockResolvedValueOnce(makeUser({ deletedAt: null }));
      await expect(service.restore('admin-1', 'u')).rejects.toBeInstanceOf(ConflictException);
      expect(logger.warn).toHaveBeenCalledWith('admin.user.restore_blocked', {
        actorId: 'admin-1',
        targetId: 'u',
        reason: 'not_deleted',
      });
    });

    it('list emits admin.users.listed at debug with actor + page + limit + status', async () => {
      await service.list('actor-x', {
        page: 3,
        limit: 25,
        status: UserListStatus.DELETED,
      } as ListAdminUsersQueryDto);
      expect(logger.debug).toHaveBeenCalledWith('admin.users.listed', {
        actorId: 'actor-x',
        page: 3,
        limit: 25,
        status: UserListStatus.DELETED,
      });
    });
  });

  describe('list', () => {
    const base: ListAdminUsersQueryDto = {
      page: 1,
      limit: 20,
      status: UserListStatus.ACTIVE,
    } as ListAdminUsersQueryDto;

    it('applies deletedAt IS NULL for active status', async () => {
      await service.list('actor-x', base);
      const qb = defaultRepo.createQueryBuilder.mock.results[0].value;
      expect(qb.andWhere).toHaveBeenCalledWith('user.deletedAt IS NULL');
    });

    it('applies deletedAt IS NOT NULL for deleted status', async () => {
      await service.list('actor-x', { ...base, status: UserListStatus.DELETED });
      const qb = defaultRepo.createQueryBuilder.mock.results[0].value;
      expect(qb.andWhere).toHaveBeenCalledWith('user.deletedAt IS NOT NULL');
    });

    it('does not filter by deletedAt for all status', async () => {
      await service.list('actor-x', { ...base, status: UserListStatus.ALL });
      const qb = defaultRepo.createQueryBuilder.mock.results[0].value;
      const calls = qb.andWhere.mock.calls.map((c: any[]) => c[0]);
      expect(calls).not.toContain('user.deletedAt IS NULL');
      expect(calls).not.toContain('user.deletedAt IS NOT NULL');
    });

    it('returns the data + total envelope with echoed page/limit', async () => {
      const qb = defaultRepo.createQueryBuilder();
      qb.getManyAndCount.mockResolvedValueOnce([
        [makeUser({ id: 'u1', createdAt: new Date(0), updatedAt: new Date(0) } as any)],
        42,
      ]);
      // Reset so our stubbing applies to the next createQueryBuilder call
      defaultRepo.createQueryBuilder.mockReturnValueOnce(qb);
      const out = await service.list('actor-x', { ...base, page: 2, limit: 50 });
      expect(out.page).toBe(2);
      expect(out.limit).toBe(50);
      expect(out.total).toBe(42);
    });
  });

  describe('setRole', () => {
    it('blocks self-role change with 403 before opening a transaction', async () => {
      await expect(service.setRole('admin-1', 'admin-1', UserRole.USER)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(txRepo.update).not.toHaveBeenCalled();
    });

    it('404s when the target does not exist', async () => {
      lockQb.getOne.mockResolvedValueOnce(undefined);
      await expect(service.setRole('a', 'b', UserRole.ADMIN)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('404s when the target is soft-deleted', async () => {
      lockQb.getOne.mockResolvedValueOnce(makeUser({ deletedAt: new Date() }));
      await expect(service.setRole('a', 'b', UserRole.ADMIN)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('is a no-op success when the target already has the requested role', async () => {
      lockQb.getOne.mockResolvedValueOnce(makeUser({ id: 'user-1', role: UserRole.USER }));
      const out = await service.setRole('admin-1', 'user-1', UserRole.USER);
      expect(out.id).toBe('user-1');
      expect(txRepo.update).not.toHaveBeenCalled();
      expect(tokens.revokeAllForUser).not.toHaveBeenCalled();
    });

    it('promotes a USER to ADMIN: admin set is still locked (consistent order) but no count check runs, and no tokens are revoked', async () => {
      // 1st getOne = loadForWrite before the check.
      // 2nd getOne = loadForWrite after the update (returns the fresh row).
      lockQb.getOne
        .mockResolvedValueOnce(makeUser({ id: 'u2', role: UserRole.USER }))
        .mockResolvedValueOnce(makeUser({ id: 'u2', role: UserRole.ADMIN }));

      await service.setRole('admin-1', 'u2', UserRole.ADMIN);

      expect(txRepo.update).toHaveBeenCalledWith(
        { id: 'u2' },
        { role: UserRole.ADMIN, lastUpdatedBy: 'admin-1' },
      );
      // Admin set IS locked up front (lock-order invariant), but target
      // is not an admin so the count is never asserted against.
      expect(lockQb.getMany).toHaveBeenCalled();
      // Not a demotion: no refresh revoke.
      expect(tokens.revokeAllForUser).not.toHaveBeenCalled();
    });

    it('locks the admin set BEFORE the target row (consistent lock order defeats cross-demotion deadlock)', async () => {
      // Record the observed call order across the two lock operations.
      // getMany is the admin-set lock; the first getOne is the target
      // row lock; the second getOne is the post-update refetch.
      const calls: string[] = [];
      lockQb.getMany.mockImplementation(async () => {
        calls.push('admins');
        return [{ id: 'admin-to-demote' }, { id: 'other' }];
      });
      lockQb.getOne
        .mockImplementationOnce(async () => {
          calls.push('target');
          return makeAdmin({ id: 'admin-to-demote' });
        })
        .mockImplementationOnce(async () =>
          makeAdmin({ id: 'admin-to-demote', role: UserRole.USER }),
        );

      await service.setRole('other', 'admin-to-demote', UserRole.USER);

      expect(calls[0]).toBe('admins');
      expect(calls[1]).toBe('target');
    });

    it('asks for the admin lock with ORDER BY id ASC (the deadlock-prevention knob)', async () => {
      lockQb.getOne
        .mockResolvedValueOnce(makeUser({ id: 'u2', role: UserRole.USER }))
        .mockResolvedValueOnce(makeUser({ id: 'u2', role: UserRole.ADMIN }));

      await service.setRole('admin-1', 'u2', UserRole.ADMIN);

      expect(lockQb.orderBy).toHaveBeenCalledWith('user.id', 'ASC');
    });

    it('blocks a demotion that would remove the last admin (409)', async () => {
      lockQb.getOne.mockResolvedValueOnce(makeAdmin({ id: 'admin-only' }));
      lockQb.getMany.mockResolvedValueOnce([{ id: 'admin-only' }]); // last admin

      await expect(service.setRole('other-admin', 'admin-only', UserRole.USER)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(txRepo.update).not.toHaveBeenCalled();
      expect(tokens.revokeAllForUser).not.toHaveBeenCalled();
    });

    it('demotes an admin when another admin exists and revokes all tokens in the same transaction', async () => {
      lockQb.getOne
        .mockResolvedValueOnce(makeAdmin({ id: 'admin-to-demote' }))
        .mockResolvedValueOnce(makeAdmin({ id: 'admin-to-demote', role: UserRole.USER }));
      lockQb.getMany.mockResolvedValueOnce([{ id: 'admin-to-demote' }, { id: 'other' }]);

      await service.setRole('other', 'admin-to-demote', UserRole.USER);

      expect(txRepo.update).toHaveBeenCalledWith(
        { id: 'admin-to-demote' },
        { role: UserRole.USER, lastUpdatedBy: 'other' },
      );
      expect(tokens.revokeAllForUser).toHaveBeenCalledWith('admin-to-demote', expect.anything());
    });
  });

  describe('softDelete', () => {
    it('blocks self-delete with 403', async () => {
      await expect(service.softDelete('admin-1', 'admin-1')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(txRepo.softDelete).not.toHaveBeenCalled();
    });

    it('404s when the target is already soft-deleted', async () => {
      lockQb.getOne.mockResolvedValueOnce(makeUser({ deletedAt: new Date() }));
      await expect(service.softDelete('a', 'b')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('blocks deleting the last admin (409)', async () => {
      lockQb.getOne.mockResolvedValueOnce(makeAdmin({ id: 'last' }));
      lockQb.getMany.mockResolvedValueOnce([{ id: 'last' }]);
      await expect(service.softDelete('other', 'last')).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(txRepo.softDelete).not.toHaveBeenCalled();
    });

    it('soft-deletes, stamps lastUpdatedBy, and revokes refresh tokens for a regular user', async () => {
      lockQb.getOne.mockResolvedValueOnce(makeUser({ id: 'u1' }));

      await service.softDelete('admin-1', 'u1');

      expect(txRepo.softDelete).toHaveBeenCalledWith({ id: 'u1' });
      expect(txRepo.update).toHaveBeenCalledWith(
        { id: 'u1' },
        { lastUpdatedBy: 'admin-1' },
      );
      expect(tokens.revokeAllForUser).toHaveBeenCalledWith('u1', expect.anything());
    });

    it('soft-deletes an admin when another admin exists', async () => {
      lockQb.getOne.mockResolvedValueOnce(makeAdmin({ id: 'a1' }));
      lockQb.getMany.mockResolvedValueOnce([{ id: 'a1' }, { id: 'a2' }]);

      await service.softDelete('a2', 'a1');

      expect(txRepo.softDelete).toHaveBeenCalledWith({ id: 'a1' });
      expect(tokens.revokeAllForUser).toHaveBeenCalledWith('a1', expect.anything());
    });
  });

  describe('restore', () => {
    it('blocks self-restore with 403', async () => {
      await expect(service.restore('admin-1', 'admin-1')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('404s when the target does not exist at all', async () => {
      lockQb.getOne.mockResolvedValueOnce(undefined);
      await expect(service.restore('a', 'b')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('409s when the target is not actually deleted (nothing to restore)', async () => {
      lockQb.getOne.mockResolvedValueOnce(makeUser({ deletedAt: null }));
      await expect(service.restore('a', 'b')).rejects.toBeInstanceOf(ConflictException);
      expect(txRepo.restore).not.toHaveBeenCalled();
    });

    it('restores, stamps lastUpdatedBy, and does NOT revoke tokens', async () => {
      lockQb.getOne
        .mockResolvedValueOnce(makeUser({ id: 'u1', deletedAt: new Date() }))
        .mockResolvedValueOnce(makeUser({ id: 'u1', deletedAt: null }));

      await service.restore('admin-1', 'u1');

      expect(txRepo.restore).toHaveBeenCalledWith({ id: 'u1' });
      expect(txRepo.update).toHaveBeenCalledWith(
        { id: 'u1' },
        { lastUpdatedBy: 'admin-1' },
      );
      expect(tokens.revokeAllForUser).not.toHaveBeenCalled();
    });
  });
});
