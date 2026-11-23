/* eslint-disable @typescript-eslint/no-explicit-any */
import 'reflect-metadata';
import { jest } from '@jest/globals';
import { UnauthorizedException } from '@nestjs/common';
import { getDataSourceToken } from '@nestjs/typeorm';
import { Test, TestingModule } from '@nestjs/testing';
import { UserRole } from '../users/user.entity.js';
import { UsersService } from '../users/users.service.js';
import { AuthService } from './auth.service.js';
import { TokenService } from './token.service.js';

type MockedUsers = jest.Mocked<Pick<
  UsersService,
  | 'findForAuth'
  | 'verifyPassword'
  | 'markLoggedIn'
  | 'findActiveById'
  | 'getPasswordContext'
  | 'hashPassword'
  | 'updatePasswordHash'
>>;

type MockedTokens = jest.Mocked<Pick<
  TokenService,
  'issueTokensForUser' | 'rotate' | 'revokeAllForUser'
>>;

describe('AuthService', () => {
  let service: AuthService;
  let users: MockedUsers;
  let tokens: MockedTokens;

  const tokenPair = {
    accessToken: 'at',
    accessTokenExpiresIn: 900,
    refreshToken: 'rt',
    refreshTokenExpiresAt: new Date().toISOString(),
  };

  // Simple transaction stub: runs the callback with a sentinel "manager" so
  // the test can assert the manager was threaded into the inner calls.
  const txManager = { __tag: 'em' } as any;
  const dataSource = {
    transaction: jest.fn(async (cb: (em: any) => Promise<unknown>) => cb(txManager)),
  };

  beforeEach(async () => {
    dataSource.transaction.mockClear();
    users = {
      findForAuth: jest.fn(),
      verifyPassword: jest.fn(),
      markLoggedIn: jest.fn(),
      findActiveById: jest.fn(),
      getPasswordContext: jest.fn(),
      hashPassword: jest.fn(),
      updatePasswordHash: jest.fn(),
    } as MockedUsers;
    tokens = {
      issueTokensForUser: jest.fn(),
      rotate: jest.fn(),
      revokeAllForUser: jest.fn(),
    } as MockedTokens;

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: UsersService, useValue: users },
        { provide: TokenService, useValue: tokens },
        { provide: getDataSourceToken(), useValue: dataSource },
      ],
    }).compile();
    service = moduleRef.get(AuthService);
  });

  describe('login', () => {
    const input = { identifier: 'rishab', password: 'correct horse battery staple' };

    it('issues tokens and records lastLoginAt on valid credentials', async () => {
      users.findForAuth.mockResolvedValue({ id: 'u1', role: UserRole.USER, passwordHash: 'h' });
      users.verifyPassword.mockResolvedValue(true);
      tokens.issueTokensForUser.mockResolvedValue(tokenPair);

      const result = await service.login(input);

      expect(result).toBe(tokenPair);
      expect(tokens.issueTokensForUser).toHaveBeenCalledWith({ id: 'u1', role: UserRole.USER });
      expect(users.markLoggedIn).toHaveBeenCalledWith('u1');
    });

    it('throws 401 for an unknown identifier without marking login', async () => {
      users.findForAuth.mockResolvedValue(null);
      await expect(service.login(input)).rejects.toBeInstanceOf(UnauthorizedException);
      expect(users.verifyPassword).not.toHaveBeenCalled();
      expect(users.markLoggedIn).not.toHaveBeenCalled();
    });

    it('throws 401 for a wrong password without marking login', async () => {
      users.findForAuth.mockResolvedValue({ id: 'u1', role: UserRole.USER, passwordHash: 'h' });
      users.verifyPassword.mockResolvedValue(false);
      await expect(service.login(input)).rejects.toBeInstanceOf(UnauthorizedException);
      expect(tokens.issueTokensForUser).not.toHaveBeenCalled();
      expect(users.markLoggedIn).not.toHaveBeenCalled();
    });
  });

  describe('refresh', () => {
    it('delegates to TokenService.rotate with a user-lookup callback', async () => {
      users.findActiveById.mockResolvedValue({ id: 'u1', role: UserRole.USER });
      tokens.rotate.mockImplementation(async (_raw, lookup) => {
        // Verify the callback wiring works: calling it must reach UsersService.
        const user = await lookup('u1');
        expect(user).toEqual({ id: 'u1', role: UserRole.USER });
        return tokenPair;
      });

      const result = await service.refresh('raw');
      expect(result).toBe(tokenPair);
      expect(users.findActiveById).toHaveBeenCalledWith('u1');
    });
  });

  describe('changePassword', () => {
    const input = {
      currentPassword: 'old correct horse',
      newPassword: 'new sufficiently long password',
    };
    const ctx = {
      id: 'u1',
      role: UserRole.USER,
      passwordHash: 'oldhash',
    };

    it('verifies, hashes, updates and revokes inside a transaction, then issues a fresh pair', async () => {
      users.getPasswordContext.mockResolvedValue(ctx);
      users.verifyPassword.mockResolvedValue(true);
      users.hashPassword.mockResolvedValue('newhash');
      tokens.issueTokensForUser.mockResolvedValue(tokenPair);

      const result = await service.changePassword('u1', input);

      expect(result).toBe(tokenPair);
      // argon2 happens BEFORE the transaction opens.
      expect(users.hashPassword).toHaveBeenCalledWith(input.newPassword);
      expect(dataSource.transaction).toHaveBeenCalledTimes(1);
      // Both inner writes receive the same EntityManager handle.
      expect(users.updatePasswordHash).toHaveBeenCalledWith('u1', 'newhash', txManager);
      expect(tokens.revokeAllForUser).toHaveBeenCalledWith('u1', txManager);
      // Fresh tokens issued AFTER the transaction.
      expect(tokens.issueTokensForUser).toHaveBeenCalledWith({ id: 'u1', role: UserRole.USER });
    });

    it('throws 401 when the user no longer exists (or is soft-deleted)', async () => {
      users.getPasswordContext.mockResolvedValue(null);

      await expect(service.changePassword('u1', input)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      expect(users.hashPassword).not.toHaveBeenCalled();
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('throws 401 when the current password is wrong and does not touch the DB', async () => {
      users.getPasswordContext.mockResolvedValue(ctx);
      users.verifyPassword.mockResolvedValue(false);

      await expect(service.changePassword('u1', input)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      expect(users.hashPassword).not.toHaveBeenCalled();
      expect(dataSource.transaction).not.toHaveBeenCalled();
      expect(tokens.issueTokensForUser).not.toHaveBeenCalled();
    });

    it('does not issue tokens if the transaction fails', async () => {
      users.getPasswordContext.mockResolvedValue(ctx);
      users.verifyPassword.mockResolvedValue(true);
      users.hashPassword.mockResolvedValue('newhash');
      dataSource.transaction.mockImplementationOnce(async () => {
        throw new Error('db down');
      });

      await expect(service.changePassword('u1', input)).rejects.toThrow('db down');
      expect(tokens.issueTokensForUser).not.toHaveBeenCalled();
    });
  });
});
