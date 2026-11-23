/* eslint-disable @typescript-eslint/no-explicit-any */
import 'reflect-metadata';
import { createHash } from 'node:crypto';
import { jest } from '@jest/globals';
import { ConfigService } from '@nestjs/config';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ScopedLogger } from '../common/logging/scoped-logger.js';
import { createScopedLoggerMock } from '../common/logging/scoped-logger.mock.js';
import { UserRole } from '../users/user.entity.js';
import { RefreshToken } from './refresh-token.entity.js';
import { TokenService } from './token.service.js';

describe('TokenService', () => {
  let moduleRef: TestingModule;
  let service: TokenService;
  let jwtService: JwtService;
  let saved: Partial<RefreshToken>[] = [];
  let logger: ReturnType<typeof createScopedLoggerMock>;
  const JWT_SECRET = 'a'.repeat(48);

  beforeEach(async () => {
    saved = [];
    logger = createScopedLoggerMock();

    // The repository mock remembers every save() so each test can inspect
    // exactly what hit the DB.
    const repoMock = {
      create: jest.fn((v: any) => v),
      save: jest.fn(async (entity: any) => {
        saved.push({ ...entity });
        return entity;
      }),
      findOne: jest.fn(),
      update: jest.fn(),
    } as unknown as Repository<RefreshToken>;

    const configMock: Partial<ConfigService> = {
      getOrThrow: jest.fn((key: string) => {
        switch (key) {
          case 'JWT_ACCESS_SECRET':
            return JWT_SECRET;
          case 'JWT_ACCESS_EXPIRES_IN':
            return '15m';
          case 'REFRESH_TOKEN_TTL_DAYS':
            return '7';
          default:
            throw new Error(`unexpected config key: ${key}`);
        }
      }) as any,
    };

    moduleRef = await Test.createTestingModule({
      imports: [JwtModule.register({})],
      providers: [
        TokenService,
        { provide: ConfigService, useValue: configMock },
        { provide: getRepositoryToken(RefreshToken), useValue: repoMock },
        { provide: ScopedLogger, useValue: logger.instance },
      ],
    }).compile();

    service = moduleRef.get(TokenService);
    jwtService = moduleRef.get(JwtService);
  });

  it('issues an access token that encodes sub and role and expires', async () => {
    const user = { id: 'user-123', role: UserRole.ADMIN };

    const result = await service.issueTokensForUser(user);

    expect(result.accessToken).toBeTruthy();
    expect(result.accessTokenExpiresIn).toBe(900); // "15m" => 900 seconds

    const payload = jwtService.verify<{ sub: string; role: UserRole; iat: number; exp: number }>(
      result.accessToken,
      { secret: JWT_SECRET },
    );
    expect(payload.sub).toBe('user-123');
    expect(payload.role).toBe(UserRole.ADMIN);
    // exp must be strictly after iat and roughly 15 minutes out.
    expect(payload.exp).toBeGreaterThan(payload.iat);
    expect(payload.exp - payload.iat).toBe(900);
  });

  describe('rotate', () => {
    const user = { id: 'u1', role: UserRole.USER };

    it('throws 401 when the token hash is unknown', async () => {
      const repo = moduleRef.get(getRepositoryToken(RefreshToken)) as any;
      repo.findOne = jest.fn(async () => null) as any;
      await expect(
        service.rotate('some-raw-token', async () => user),
      ).rejects.toThrow('Unauthorized');
    });

    it('nukes every active session when a revoked token is replayed (reuse) and logs auth.refresh.reuse_detected with userId', async () => {
      const repo = moduleRef.get(getRepositoryToken(RefreshToken)) as any;
      repo.findOne = jest.fn(async () => ({
        id: 'r1',
        userId: 'u1',
        tokenHash: 'h',
        expiresAt: new Date(Date.now() + 86_400_000),
        revokedAt: new Date(),
      })) as any;
      repo.update = jest.fn(async () => ({ affected: 1 })) as any;

      await expect(
        service.rotate('raw', async () => user),
      ).rejects.toThrow('Unauthorized');

      expect(repo.update).toHaveBeenCalledWith(
        { userId: 'u1', revokedAt: expect.anything() },
        { revokedAt: expect.any(Date) },
      );
      expect(logger.warn).toHaveBeenCalledWith('auth.refresh.reuse_detected', {
        userId: 'u1',
        note: 'all sessions revoked',
      });
    });

    it('unknown refresh token logs auth.refresh.rejected with reason unknown', async () => {
      const repo = moduleRef.get(getRepositoryToken(RefreshToken)) as any;
      repo.findOne = jest.fn(async () => null) as any;
      await expect(service.rotate('raw', async () => user)).rejects.toThrow('Unauthorized');
      expect(logger.warn).toHaveBeenCalledWith('auth.refresh.rejected', { reason: 'unknown' });
    });

    it('throws 401 when the token is expired', async () => {
      const repo = moduleRef.get(getRepositoryToken(RefreshToken)) as any;
      repo.findOne = jest.fn(async () => ({
        id: 'r1',
        userId: 'u1',
        tokenHash: 'h',
        expiresAt: new Date(Date.now() - 1_000),
        revokedAt: null,
      })) as any;
      await expect(
        service.rotate('raw', async () => user),
      ).rejects.toThrow('Unauthorized');
    });

    it('throws 401 when the user has since been deleted', async () => {
      const repo = moduleRef.get(getRepositoryToken(RefreshToken)) as any;
      repo.findOne = jest.fn(async () => ({
        id: 'r1',
        userId: 'u1',
        tokenHash: 'h',
        expiresAt: new Date(Date.now() + 86_400_000),
        revokedAt: null,
      })) as any;
      await expect(service.rotate('raw', async () => null)).rejects.toThrow('Unauthorized');
    });
  });

  describe('revoke', () => {
    it('updates revokedAt for active tokens with the given hash', async () => {
      const repo = moduleRef.get(getRepositoryToken(RefreshToken)) as any;
      repo.update = jest.fn(async () => ({ affected: 1 })) as any;
      await service.revoke('some-raw-token');
      const [criteria, patch] = repo.update.mock.calls[0];
      expect(criteria.tokenHash).toBeDefined();
      expect(criteria.revokedAt).toBeDefined();
      expect(patch.revokedAt).toBeInstanceOf(Date);
    });
  });

  it('stores a refresh token only as a sha256 hash, never as the raw value', async () => {
    const user = { id: 'user-123', role: UserRole.USER };

    const result = await service.issueTokensForUser(user);

    expect(saved).toHaveLength(1);
    const row = saved[0];

    // Every stored field is expected; the raw token is NOT among them.
    expect(row.userId).toBe('user-123');
    expect(row.expiresAt).toBeInstanceOf(Date);
    expect(row.tokenHash).toBeDefined();

    // Equal to the sha256 of the response token, and NOT equal to the raw token.
    const expected = createHash('sha256').update(result.refreshToken).digest('hex');
    expect(row.tokenHash).toBe(expected);
    expect(row.tokenHash).not.toBe(result.refreshToken);

    // No field of the stored row holds the raw token value.
    const storedValues = Object.values(row);
    expect(storedValues).not.toContain(result.refreshToken);
  });

  describe('revokeAllForUser', () => {
    it('updates every active refresh token for the user on the default repo', async () => {
      const repo = moduleRef.get(getRepositoryToken(RefreshToken)) as any;
      await service.revokeAllForUser('u1');
      expect(repo.update).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'u1' }),
        expect.objectContaining({ revokedAt: expect.any(Date) }),
      );
    });

    it('routes through the EntityManager repository when a manager is passed (transactional)', async () => {
      const managerRepo = { update: jest.fn() };
      const manager = { getRepository: jest.fn(() => managerRepo) } as any;
      const defaultRepo = moduleRef.get(getRepositoryToken(RefreshToken)) as any;

      await service.revokeAllForUser('u1', manager);

      expect(manager.getRepository).toHaveBeenCalledWith(RefreshToken);
      expect(managerRepo.update).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'u1' }),
        expect.objectContaining({ revokedAt: expect.any(Date) }),
      );
      // Transactional path must NOT touch the default repo.
      expect(defaultRepo.update).not.toHaveBeenCalled();
    });
  });
});
