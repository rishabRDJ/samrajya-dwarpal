import 'reflect-metadata';
import { jest } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import * as argon2 from 'argon2';
import { Repository } from 'typeorm';
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
});
