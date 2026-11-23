/* eslint-disable @typescript-eslint/no-explicit-any */
import 'reflect-metadata';
import { jest } from '@jest/globals';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import * as argon2 from 'argon2';
import { QueryFailedError } from 'typeorm';
import { User, UserRole } from './user.entity.js';
import { UsersService } from './users.service.js';

describe('UsersService', () => {
  let service: UsersService;
  let repoMock: any;
  let qb: any;

  beforeEach(async () => {
    // findForAuth uses a QueryBuilder; the other methods use findOne/update.
    // Mock both paths with a captured chain.
    qb = {
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getOne: jest.fn(),
    };
    repoMock = {
      createQueryBuilder: jest.fn(() => qb),
      findOne: jest.fn(),
      update: jest.fn(),
    };

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: getRepositoryToken(User), useValue: repoMock },
      ],
    }).compile();
    service = moduleRef.get(UsersService);
  });

  describe('findForAuth', () => {
    it('queries by emailAddress when identifier contains @', async () => {
      qb.getOne.mockResolvedValue({ id: 'u1', role: UserRole.USER, passwordHash: 'h' });
      const out = await service.findForAuth('user@test.local');
      expect(qb.where).toHaveBeenCalledWith('user.emailAddress = :identifier', { identifier: 'user@test.local' });
      expect(out).toEqual({ id: 'u1', role: UserRole.USER, passwordHash: 'h' });
    });

    it('queries by username when identifier lacks @', async () => {
      qb.getOne.mockResolvedValue({ id: 'u1', role: UserRole.USER, passwordHash: 'h' });
      await service.findForAuth('rishab');
      expect(qb.where).toHaveBeenCalledWith('user.username = :identifier', { identifier: 'rishab' });
    });

    it('returns null when no row matches', async () => {
      qb.getOne.mockResolvedValue(undefined);
      expect(await service.findForAuth('nobody')).toBeNull();
    });
  });

  describe('getActiveProfile', () => {
    it('returns the full user when active', async () => {
      const row = { id: 'u1', username: 'rishab', role: UserRole.USER } as any;
      repoMock.findOne.mockResolvedValue(row);
      await expect(service.getActiveProfile('u1')).resolves.toBe(row);
    });

    it('throws 401 when missing or soft-deleted', async () => {
      repoMock.findOne.mockResolvedValue(null);
      const { UnauthorizedException } = await import('@nestjs/common');
      await expect(service.getActiveProfile('u1')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });
  });

  describe('findActiveById', () => {
    it('returns id and role when row exists', async () => {
      repoMock.findOne.mockResolvedValue({ id: 'u1', role: UserRole.ADMIN });
      expect(await service.findActiveById('u1')).toEqual({ id: 'u1', role: UserRole.ADMIN });
    });

    it('returns null when row missing or soft-deleted', async () => {
      repoMock.findOne.mockResolvedValue(null);
      expect(await service.findActiveById('u1')).toBeNull();
    });
  });

  describe('verifyPassword', () => {
    it('returns true for a matching password', async () => {
      const hash = await argon2.hash('correct horse battery staple');
      expect(await service.verifyPassword(hash, 'correct horse battery staple')).toBe(true);
    });

    it('returns false for a wrong password', async () => {
      const hash = await argon2.hash('correct horse battery staple');
      expect(await service.verifyPassword(hash, 'nope but long enough')).toBe(false);
    });

    it('returns false (not throws) on a malformed hash string', async () => {
      expect(await service.verifyPassword('not-a-real-argon2-hash', 'anything')).toBe(false);
    });
  });

  describe('markLoggedIn', () => {
    it('updates lastLoginAt with a current timestamp', async () => {
      await service.markLoggedIn('u1');
      const [criteria, patch] = repoMock.update.mock.calls[0];
      expect(criteria).toEqual({ id: 'u1' });
      expect(patch.lastLoginAt).toBeInstanceOf(Date);
    });
  });

  describe('register', () => {
    const input = {
      username: 'rishab',
      emailAddress: 'rishab@example.com',
      firstName: 'Rishab',
      lastName: 'Jaiswal',
      password: 'correct horse battery staple',
    };

    beforeEach(() => {
      repoMock.create = jest.fn((v: any) => v);
      repoMock.save = jest.fn(async (v: any) => ({ id: 'new-id', ...v }));
    });

    it('argon2-hashes the password and persists the user with role USER', async () => {
      const result = await service.register(input);

      const saved = (repoMock.save as any).mock.calls[0][0];
      expect(saved.passwordHash).toMatch(/^\$argon2/);
      expect(saved.passwordHash).not.toBe(input.password);
      expect(saved.role).toBe(UserRole.USER);
      expect(saved.phoneNumber).toBeNull();
      expect(result.id).toBe('new-id');
    });

    it('translates a MySQL duplicate-key error into 409 ConflictException', async () => {
      const dup = new QueryFailedError('q', [], new Error('dup'));
      (dup as any).driverError = { code: 'ER_DUP_ENTRY' };
      repoMock.save = jest.fn(async () => {
        throw dup;
      });
      await expect(service.register(input)).rejects.toBeInstanceOf(ConflictException);
    });

    it('rethrows unexpected database errors as-is', async () => {
      const boom = new QueryFailedError('q', [], new Error('boom'));
      (boom as any).driverError = { code: 'ER_SOMETHING_ELSE' };
      repoMock.save = jest.fn(async () => {
        throw boom;
      });
      await expect(service.register(input)).rejects.toBe(boom);
    });
  });

  describe('getPasswordContext', () => {
    it('returns id, role and passwordHash via QueryBuilder (addSelect on passwordHash)', async () => {
      qb.getOne.mockResolvedValue({ id: 'u1', role: UserRole.USER, passwordHash: 'h' });
      const out = await service.getPasswordContext('u1');
      expect(qb.where).toHaveBeenCalledWith('user.id = :id', { id: 'u1' });
      expect(out).toEqual({ id: 'u1', role: UserRole.USER, passwordHash: 'h' });
    });

    it('returns null when the user is missing or soft-deleted', async () => {
      qb.getOne.mockResolvedValue(undefined);
      expect(await service.getPasswordContext('u1')).toBeNull();
    });
  });

  describe('updatePasswordHash', () => {
    it('compare-and-set: WHERE includes id AND the expected current hash, SET swaps + stamps', async () => {
      repoMock.update = jest.fn(async () => ({ affected: 1 }));
      const ok = await service.updatePasswordHash('u1', 'oldhash', 'newhash');
      expect(ok).toBe(true);
      expect(repoMock.update).toHaveBeenCalledWith(
        { id: 'u1', passwordHash: 'oldhash' },
        { passwordHash: 'newhash', lastUpdatedBy: 'u1' },
      );
    });

    it('returns false when nothing matched (row was mutated under us)', async () => {
      repoMock.update = jest.fn(async () => ({ affected: 0 }));
      const ok = await service.updatePasswordHash('u1', 'staleOldHash', 'newhash');
      expect(ok).toBe(false);
    });

    it('uses the EntityManager repository when one is passed (transactional)', async () => {
      const managerRepo = { update: jest.fn(async () => ({ affected: 1 })) };
      const manager = { getRepository: jest.fn(() => managerRepo) } as any;
      await service.updatePasswordHash('u1', 'oldhash', 'newhash', manager);
      expect(manager.getRepository).toHaveBeenCalled();
      expect(managerRepo.update).toHaveBeenCalledWith(
        { id: 'u1', passwordHash: 'oldhash' },
        { passwordHash: 'newhash', lastUpdatedBy: 'u1' },
      );
      // Default repo must NOT be touched when a manager is supplied.
      expect(repoMock.update).not.toHaveBeenCalled();
    });
  });

  describe('hashPassword', () => {
    it('produces an argon2id hash that round-trips through argon2.verify', async () => {
      const hash = await service.hashPassword('correct horse battery staple');
      expect(hash).toMatch(/^\$argon2/);
      expect(await argon2.verify(hash, 'correct horse battery staple')).toBe(true);
    });
  });

  describe('updateProfile', () => {
    beforeEach(() => {
      // getActiveProfile is called at the end to return the fresh row.
      repoMock.update = jest.fn(async () => ({ affected: 1 }));
      repoMock.findOne.mockResolvedValue({
        id: 'u1',
        firstName: 'New',
        lastName: 'Name',
        phoneNumber: '+919876543210',
      });
    });

    it('builds a patch from only the provided fields and stamps lastUpdatedBy', async () => {
      await service.updateProfile('u1', { firstName: 'New' });
      const [criteria, patch] = repoMock.update.mock.calls[0];
      expect(criteria).toEqual(expect.objectContaining({ id: 'u1' }));
      expect(patch).toEqual({ firstName: 'New', lastUpdatedBy: 'u1' });
      expect(patch.lastName).toBeUndefined();
      expect(patch.phoneNumber).toBeUndefined();
    });

    it('allows null phoneNumber (clears the stored value)', async () => {
      await service.updateProfile('u1', { phoneNumber: null });
      const [, patch] = repoMock.update.mock.calls[0];
      expect(patch.phoneNumber).toBeNull();
    });

    it('throws 400 when no fields are provided', async () => {
      await expect(service.updateProfile('u1', {})).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(repoMock.update).not.toHaveBeenCalled();
    });

    it('maps a MySQL duplicate-key error into 409', async () => {
      const dup = new QueryFailedError('q', [], new Error('dup'));
      (dup as any).driverError = { code: 'ER_DUP_ENTRY' };
      repoMock.update = jest.fn(async () => {
        throw dup;
      });
      await expect(
        service.updateProfile('u1', { phoneNumber: '+919876543210' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('rethrows unexpected database errors as-is', async () => {
      const boom = new QueryFailedError('q', [], new Error('boom'));
      (boom as any).driverError = { code: 'ER_SOMETHING_ELSE' };
      repoMock.update = jest.fn(async () => {
        throw boom;
      });
      await expect(
        service.updateProfile('u1', { firstName: 'X' }),
      ).rejects.toBe(boom);
    });

    it('re-reads the fresh profile after updating', async () => {
      const result = await service.updateProfile('u1', { firstName: 'New' });
      expect(repoMock.findOne).toHaveBeenCalled();
      expect(result).toEqual(
        expect.objectContaining({ id: 'u1', firstName: 'New' }),
      );
    });
  });

  describe('isAvailable', () => {
    it('returns true when no user with that username exists', async () => {
      repoMock.findOne.mockResolvedValue(null);
      expect(await service.isAvailable({ username: 'rishab' })).toBe(true);
      // Soft-deleted rows must count — identifiers stay reserved.
      expect(repoMock.findOne).toHaveBeenCalledWith(
        expect.objectContaining({ withDeleted: true }),
      );
    });

    it('returns false when a user already holds the username (including soft-deleted)', async () => {
      repoMock.findOne.mockResolvedValue({ id: 'u1' });
      expect(await service.isAvailable({ username: 'rishab' })).toBe(false);
    });

    it('queries by emailAddress when that is the provided field', async () => {
      repoMock.findOne.mockResolvedValue(null);
      await service.isAvailable({ emailAddress: 'rishab@example.com' });
      expect(repoMock.findOne).toHaveBeenCalledWith(
        expect.objectContaining({ where: { emailAddress: 'rishab@example.com' } }),
      );
    });
  });
});
