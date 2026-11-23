import 'reflect-metadata';
import { jest } from '@jest/globals';
import { UnauthorizedException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { UserRole } from '../users/user.entity.js';
import { UsersService } from '../users/users.service.js';
import { AuthService } from './auth.service.js';
import { TokenService } from './token.service.js';

type MockedUsers = jest.Mocked<Pick<
  UsersService,
  'findForAuth' | 'verifyPassword' | 'markLoggedIn' | 'findActiveById'
>>;

type MockedTokens = jest.Mocked<Pick<
  TokenService,
  'issueTokensForUser' | 'rotate'
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

  beforeEach(async () => {
    users = {
      findForAuth: jest.fn(),
      verifyPassword: jest.fn(),
      markLoggedIn: jest.fn(),
      findActiveById: jest.fn(),
    } as MockedUsers;
    tokens = {
      issueTokensForUser: jest.fn(),
      rotate: jest.fn(),
    } as MockedTokens;

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: UsersService, useValue: users },
        { provide: TokenService, useValue: tokens },
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
});
