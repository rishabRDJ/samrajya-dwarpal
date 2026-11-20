import 'reflect-metadata';
import { createHash } from 'node:crypto';
import { jest } from '@jest/globals';
import { ConfigService } from '@nestjs/config';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserRole } from '../users/user.entity.js';
import { RefreshToken } from './refresh-token.entity.js';
import { TokenService } from './token.service.js';

describe('TokenService', () => {
  let moduleRef: TestingModule;
  let service: TokenService;
  let jwtService: JwtService;
  let saved: Partial<RefreshToken>[] = [];
  const JWT_SECRET = 'a'.repeat(48);

  beforeEach(async () => {
    saved = [];

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
});
