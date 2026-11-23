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
      getOne: jest.fn(),
      getMany: jest.fn(),
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

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        AdminUsersService,
        { provide: getRepositoryToken(User), useValue: defaultRepo },
        { provide: TokenService, useValue: tokens },
        { provide: getDataSourceToken(), useValue: dataSource },
      ],
    }).compile();

    service = moduleRef.get(AdminUsersService);
  });

  describe('list', () => {
    const base: ListAdminUsersQueryDto = {
      page: 1,
      limit: 20,
      status: UserListStatus.ACTIVE,
    } as ListAdminUsersQueryDto;

    it('applies deletedAt IS NULL for active status', async () => {
      await service.list(base);
      const qb = defaultRepo.createQueryBuilder.mock.results[0].value;
      expect(qb.andWhere).toHaveBeenCalledWith('user.deletedAt IS NULL');
    });

    it('applies deletedAt IS NOT NULL for deleted status', async () => {
      await service.list({ ...base, status: UserListStatus.DELETED });
      const qb = defaultRepo.createQueryBuilder.mock.results[0].value;
      expect(qb.andWhere).toHaveBeenCalledWith('user.deletedAt IS NOT NULL');
    });

    it('does not filter by deletedAt for all status', async () => {
      await service.list({ ...base, status: UserListStatus.ALL });
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
      const out = await service.list({ ...base, page: 2, limit: 50 });
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

    it('promotes a USER to ADMIN without touching the last-admin check or revoking tokens', async () => {
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
      // Not a demotion: never query the admin set, never revoke.
      expect(lockQb.getMany).not.toHaveBeenCalled();
      expect(tokens.revokeAllForUser).not.toHaveBeenCalled();
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
