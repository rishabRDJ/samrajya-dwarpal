/* eslint-disable @typescript-eslint/no-explicit-any */
import 'reflect-metadata';
import { jest } from '@jest/globals';
import type { User } from '../users/user.entity.js';

// AuthController imports @nestjs/throttler at load time via @Throttle. Mock
// it before any downstream import so the ESM require-cycle check does not
// fire. Dynamic imports below the mock keep the registration order correct.
jest.unstable_mockModule('@nestjs/throttler', () => ({
  __esModule: true,
  Throttle: () => () => undefined,
  ThrottlerModule: { forRoot: () => ({ module: class {}, providers: [] }) },
  ThrottlerGuard: class {
    canActivate(): boolean {
      return true;
    }
  },
}));

let Test: typeof import('@nestjs/testing').Test;
let AuthController: typeof import('./auth.controller.js').AuthController;
let AuthService: typeof import('./auth.service.js').AuthService;
let UsersService: typeof import('../users/users.service.js').UsersService;
let TokenService: typeof import('./token.service.js').TokenService;
let toUserResponse: typeof import('../users/dto/user-response.dto.js').toUserResponse;
let UserRole: typeof import('../users/user.entity.js').UserRole;

describe('AuthController', () => {
  let controller: InstanceType<typeof AuthController>;
  let auth: any;
  let users: any;
  let tokens: any;

  const tokenPair = {
    accessToken: 'at',
    accessTokenExpiresIn: 900,
    refreshToken: 'rt',
    refreshTokenExpiresAt: new Date().toISOString(),
  };

  beforeAll(async () => {
    ({ Test } = await import('@nestjs/testing'));
    ({ AuthController } = await import('./auth.controller.js'));
    ({ AuthService } = await import('./auth.service.js'));
    ({ UsersService } = await import('../users/users.service.js'));
    ({ TokenService } = await import('./token.service.js'));
    ({ toUserResponse } = await import('../users/dto/user-response.dto.js'));
    ({ UserRole } = await import('../users/user.entity.js'));
  });

  beforeEach(async () => {
    auth = { login: jest.fn(), refresh: jest.fn() };
    users = { register: jest.fn(), isAvailable: jest.fn() };
    tokens = { revoke: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: auth },
        { provide: UsersService, useValue: users },
        { provide: TokenService, useValue: tokens },
      ],
    }).compile();
    controller = moduleRef.get(AuthController);
  });

  describe('login', () => {
    it('maps LoginDto to LoginInput and forwards to AuthService.login', async () => {
      auth.login.mockResolvedValue(tokenPair);
      const result = await controller.login({ identifier: 'rishab', password: 'secret12345' });
      expect(auth.login).toHaveBeenCalledWith({ identifier: 'rishab', password: 'secret12345' });
      expect(result).toBe(tokenPair);
    });
  });

  describe('refresh', () => {
    it('passes the raw refresh token to AuthService.refresh', async () => {
      auth.refresh.mockResolvedValue(tokenPair);
      const result = await controller.refresh({ refreshToken: 'raw' });
      expect(auth.refresh).toHaveBeenCalledWith('raw');
      expect(result).toBe(tokenPair);
    });
  });

  describe('logout', () => {
    it('delegates straight to TokenService.revoke (no business flow)', async () => {
      await controller.logout({ refreshToken: 'raw' });
      expect(tokens.revoke).toHaveBeenCalledWith('raw');
    });
  });

  describe('register', () => {
    it('forwards RegisterDto as RegisterInput and maps through toUserResponse', async () => {
      const entity = {
        id: 'u1',
        username: 'rishab',
        emailAddress: 'rishab@example.com',
        firstName: 'Rishab',
        lastName: 'Jaiswal',
        phoneNumber: null,
        role: UserRole.USER,
        lastLoginAt: null,
        emailVerifiedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as User;
      users.register.mockResolvedValue(entity);

      const result = await controller.register({
        username: 'rishab',
        emailAddress: 'rishab@example.com',
        firstName: 'Rishab',
        lastName: 'Jaiswal',
        password: 'correct horse battery staple',
      });

      expect(users.register).toHaveBeenCalledWith({
        username: 'rishab',
        emailAddress: 'rishab@example.com',
        firstName: 'Rishab',
        lastName: 'Jaiswal',
        password: 'correct horse battery staple',
        phoneNumber: undefined,
      });
      expect(result).toEqual(toUserResponse(entity));
      // Critical invariant: response must never carry passwordHash.
      expect(result).not.toHaveProperty('passwordHash');
    });
  });

  describe('availability', () => {
    it('forwards query fields and wraps the boolean', async () => {
      users.isAvailable.mockResolvedValue(true);
      const result = await controller.availability({ username: 'rishab' });
      expect(users.isAvailable).toHaveBeenCalledWith({
        username: 'rishab',
        emailAddress: undefined,
      });
      expect(result).toEqual({ available: true });
    });

    it('also forwards emailAddress when supplied', async () => {
      users.isAvailable.mockResolvedValue(false);
      const result = await controller.availability({ emailAddress: 'rishab@example.com' });
      expect(users.isAvailable).toHaveBeenCalledWith({
        username: undefined,
        emailAddress: 'rishab@example.com',
      });
      expect(result).toEqual({ available: false });
    });
  });
});
