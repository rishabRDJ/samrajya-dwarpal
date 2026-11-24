/* eslint-disable @typescript-eslint/no-explicit-any */
import 'reflect-metadata';
import { jest } from '@jest/globals';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import * as argon2 from 'argon2';
import { IsNull, QueryFailedError } from 'typeorm';
import { ScopedLogger } from '../common/logging/scoped-logger.js';
import { createScopedLoggerMock, type ScopedLoggerMock } from '../common/logging/scoped-logger.mock.js';
import { User, UserRole } from './user.entity.js';
import { UsersService } from './users.service.js';

describe('UsersService', () => {
  let service: UsersService;
  let repoMock: any;
  let qb: any;
  let logger: ScopedLoggerMock;

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

    logger = createScopedLoggerMock();
    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: getRepositoryToken(User), useValue: repoMock },
        { provide: ScopedLogger, useValue: logger.instance },
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

  describe('logging', () => {
    it('register success emits auth.register.succeeded with the new userId', async () => {
      repoMock.create = jest.fn((v: any) => v);
      repoMock.save = jest.fn(async (v: any) => ({ id: 'new-id', ...v }));
      await service.register({
        username: 'rishab',
        emailAddress: 'r@example.com',
        firstName: 'R',
        lastName: 'J',
        password: 'correct horse battery staple',
      });
      expect(logger.info).toHaveBeenCalledWith('auth.register.succeeded', { userId: 'new-id' });
    });

    it('register duplicate emits auth.register.conflict (no fields)', async () => {
      const dup = new QueryFailedError('q', [], new Error('dup'));
      (dup as any).driverError = { code: 'ER_DUP_ENTRY' };
      repoMock.create = jest.fn((v: any) => v);
      repoMock.save = jest.fn(async () => {
        throw dup;
      });
      await expect(
        service.register({
          username: 'rishab',
          emailAddress: 'r@example.com',
          firstName: 'R',
          lastName: 'J',
          password: 'correct horse battery staple',
        }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(logger.warn).toHaveBeenCalledWith('auth.register.conflict');
    });

    it('updateProfile logs only the NAMES of changed fields, not values', async () => {
      repoMock.update = jest.fn(async () => ({ affected: 1 }));
      repoMock.findOne.mockResolvedValue({
        id: 'u1',
        firstName: 'Changed',
        lastName: 'X',
        phoneNumber: '9876543210',
      });
      await service.updateProfile('u1', {
        firstName: 'Changed',
        phoneNumber: '9876543210',
      });

      // The info-level success line.
      const infoCall = logger.info.mock.calls.find(
        (c: unknown[]) => c[0] === 'user.profile.updated',
      );
      expect(infoCall).toBeDefined();
      const payload = infoCall![1] as { userId: string; fields: string[] };
      expect(payload.userId).toBe('u1');
      // Names only — must list firstName and phoneNumber, not their values.
      expect(payload.fields).toEqual(expect.arrayContaining(['firstName', 'phoneNumber']));
      expect(payload.fields).not.toEqual(expect.arrayContaining(['lastName']));
      // Values must never appear anywhere in the log call.
      expect(JSON.stringify(payload)).not.toContain('Changed');
      expect(JSON.stringify(payload)).not.toContain('9876543210');
    });

    it('updateProfile with no fields emits user.profile.update_failed reason no_fields', async () => {
      await expect(service.updateProfile('u1', {})).rejects.toBeInstanceOf(BadRequestException);
      expect(logger.warn).toHaveBeenCalledWith('user.profile.update_failed', {
        userId: 'u1',
        reason: 'no_fields',
      });
    });

    it('updateProfile with duplicate phone emits user.profile.update_failed reason duplicate_phone', async () => {
      const dup = new QueryFailedError('q', [], new Error('dup'));
      (dup as any).driverError = { code: 'ER_DUP_ENTRY' };
      repoMock.update = jest.fn(async () => {
        throw dup;
      });
      await expect(
        service.updateProfile('u1', { phoneNumber: '9876543210' }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(logger.warn).toHaveBeenCalledWith('user.profile.update_failed', {
        userId: 'u1',
        reason: 'duplicate_phone',
      });
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
    it('compare-and-set: WHERE includes id, expected current hash, AND deletedAt IS NULL', async () => {
      repoMock.update = jest.fn(async () => ({ affected: 1 }));
      const ok = await service.updatePasswordHash('u1', 'oldhash', 'newhash');
      expect(ok).toBe(true);
      expect(repoMock.update).toHaveBeenCalledWith(
        { id: 'u1', passwordHash: 'oldhash', deletedAt: IsNull() },
        { passwordHash: 'newhash', lastUpdatedBy: 'u1' },
      );
    });

    it('returns false when the hash was mutated under us (lost race)', async () => {
      repoMock.update = jest.fn(async () => ({ affected: 0 }));
      const ok = await service.updatePasswordHash('u1', 'staleOldHash', 'newhash');
      expect(ok).toBe(false);
    });

    it('returns false when the user was soft-deleted during the argon2 hash window', async () => {
      // Row still has id=u1 and passwordHash=oldhash, but deletedAt is now set.
      // The deletedAt IS NULL clause in the WHERE makes affected=0 here.
      repoMock.update = jest.fn(async () => ({ affected: 0 }));
      const ok = await service.updatePasswordHash('u1', 'oldhash', 'newhash');
      expect(ok).toBe(false);
    });

    it('uses the EntityManager repository when one is passed (transactional)', async () => {
      const managerRepo = { update: jest.fn(async () => ({ affected: 1 })) };
      const manager = { getRepository: jest.fn(() => managerRepo) } as any;
      await service.updatePasswordHash('u1', 'oldhash', 'newhash', manager);
      expect(manager.getRepository).toHaveBeenCalled();
      expect(managerRepo.update).toHaveBeenCalledWith(
        { id: 'u1', passwordHash: 'oldhash', deletedAt: IsNull() },
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
        phoneNumber: '9876543210',
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
        service.updateProfile('u1', { phoneNumber: '9876543210' }),
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
