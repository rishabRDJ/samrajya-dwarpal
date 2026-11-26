/* eslint-disable @typescript-eslint/no-explicit-any */
import 'reflect-metadata';
import { jest } from '@jest/globals';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import type { DataSource, Repository } from 'typeorm';
import { EncryptionService } from '../common/crypto/encryption.service.js';
import { createScopedLoggerMock } from '../common/logging/scoped-logger.mock.js';
import {
  deriveExpiresAt,
  FyersAuthService,
  FyersTokenError,
  hashState,
} from './fyers-auth.service.js';
import { FyersClient } from './fyers.client.js';
import { FyersCredential } from './fyers-credential.entity.js';
import { FyersOauthState } from './fyers-oauth-state.entity.js';

const DARBAR = 'https://darbar.test';

function chainableUpdate(affected: number) {
  const execute = jest.fn(async () => ({ affected }));
  const andWhere = jest.fn().mockReturnThis();
  const where = jest.fn().mockReturnThis();
  const set = jest.fn().mockReturnThis();
  const update = jest.fn().mockReturnThis();
  const qb = { update, set, where, andWhere, execute };
  return { qb, execute };
}

function buildService(opts: {
  affected?: number;
  foundState?: { userId: string } | null;
  foundCredential?: Partial<FyersCredential> | null;
  clientOverride?: Partial<FyersClient>;
  encryptOverride?: Partial<EncryptionService>;
}) {
  const { qb, execute } = chainableUpdate(opts.affected ?? 1);

  const states = {
    insert: jest.fn(async () => undefined),
    delete: jest.fn(async () => ({ affected: 0 })),
    findOneBy: jest.fn(async () => opts.foundState ?? { userId: 'user-1' }),
    createQueryBuilder: jest.fn(() => qb),
  } as unknown as jest.Mocked<Repository<FyersOauthState>>;

  const credentials = {
    findOneBy: jest.fn(async () => opts.foundCredential ?? null),
    upsert: jest.fn(async () => undefined),
  } as unknown as jest.Mocked<Repository<FyersCredential>>;

  const client = {
    buildAuthUrl: jest.fn(
      (state: string) => `https://fyers.test/auth?state=${state}`,
    ),
    exchangeAuthCode: jest.fn(async () => ({ accessToken: 'tok' })),
    ...opts.clientOverride,
  } as unknown as jest.Mocked<FyersClient>;

  const encryption = {
    encrypt: jest.fn(() => ({
      encryptedToken: 'ct',
      iv: 'iv',
      authTag: 'tag',
      keyVersion: 1,
    })),
    decrypt: jest.fn(() => 'decrypted-token'),
    ...opts.encryptOverride,
  } as unknown as jest.Mocked<EncryptionService>;

  const logger = createScopedLoggerMock();
  const config = {
    getOrThrow: (k: string) => (k === 'DARBAR_APP_URL' ? DARBAR : ''),
  } as unknown as ConfigService;
  const dataSource = {} as DataSource;

  const service = new FyersAuthService(
    client,
    encryption,
    logger.instance,
    config,
    states,
    credentials,
    dataSource,
  );
  return { service, states, credentials, client, encryption, logger, execute };
}

describe('hashState', () => {
  it('produces the standard lowercase hex SHA-256 of the raw state', () => {
    const raw = 'abc123';
    const expected = createHash('sha256').update(raw).digest('hex');
    expect(hashState(raw)).toBe(expected);
    expect(hashState(raw)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('deriveExpiresAt', () => {
  it('uses the JWT exp when it is sooner than 23:59:59 UTC today', () => {
    const exp = Math.floor(Date.now() / 1000) + 60;
    const payload = Buffer.from(JSON.stringify({ exp })).toString('base64url');
    const jwt = `header.${payload}.sig`;
    expect(deriveExpiresAt(jwt).getTime()).toBe(exp * 1000);
  });

  it('caps at 23:59:59.999 UTC today when the JWT exp is further out', () => {
    const exp = Math.floor(Date.now() / 1000) + 48 * 3600;
    const payload = Buffer.from(JSON.stringify({ exp })).toString('base64url');
    const jwt = `header.${payload}.sig`;
    const got = deriveExpiresAt(jwt);
    expect(got.getUTCHours()).toBe(23);
    expect(got.getUTCMinutes()).toBe(59);
    expect(got.getUTCSeconds()).toBe(59);
    expect(got.getUTCMilliseconds()).toBe(999);
    expect(got.getUTCDate()).toBe(new Date().getUTCDate());
    expect(got.getTime()).toBeLessThan(exp * 1000);
  });

  it('falls back to 23:59:59.999 UTC today when the token is opaque', () => {
    const d = deriveExpiresAt('not-a-jwt');
    expect(d.getUTCHours()).toBe(23);
    expect(d.getUTCMinutes()).toBe(59);
    expect(d.getUTCSeconds()).toBe(59);
    expect(d.getUTCMilliseconds()).toBe(999);
  });
});

describe('FyersAuthService.createLoginUrl', () => {
  it('stores the SHA-256 hash of the state with a 10-minute expiry and returns the Fyers URL', async () => {
    const { service, states, client, logger } = buildService({});
    const { url } = await service.createLoginUrl('user-1');

    expect(client.buildAuthUrl).toHaveBeenCalledTimes(1);
    const rawState = (client.buildAuthUrl as jest.Mock).mock.calls[0][0] as string;
    expect(url).toContain(rawState);

    const insertArg = (states.insert as jest.Mock).mock.calls[0][0] as {
      stateHash: string;
      userId: string;
      expiresAt: Date;
    };
    expect(insertArg.stateHash).toBe(hashState(rawState));
    expect(insertArg.userId).toBe('user-1');
    const ttl = insertArg.expiresAt.getTime() - Date.now();
    expect(ttl).toBeGreaterThan(9 * 60 * 1000);
    expect(ttl).toBeLessThanOrEqual(10 * 60 * 1000 + 50);

    expect(logger.info).toHaveBeenCalledWith('fyers.oauth.started', {
      userId: 'user-1',
    });
  });
});

describe('FyersAuthService.handleCallback', () => {
  it('redirects with reason=denied when Fyers reports an error', async () => {
    const { service, logger } = buildService({});
    const redirect = await service.handleCallback({ s: 'error' });
    expect(redirect).toContain(`${DARBAR}/dashboard`);
    expect(redirect).toContain('status=error');
    expect(redirect).toContain('reason=denied');
    expect(logger.warn).toHaveBeenCalledWith('fyers.oauth.failed', {
      reason: 'denied',
    });
  });

  it('redirects with reason=denied when auth_code or state is missing', async () => {
    const { service } = buildService({});
    const r1 = await service.handleCallback({ state: 'x' });
    const r2 = await service.handleCallback({ auth_code: 'y' });
    expect(r1).toContain('reason=denied');
    expect(r2).toContain('reason=denied');
  });

  it('redirects with reason=invalid_state when the UPDATE changes zero rows', async () => {
    const { service, logger } = buildService({ affected: 0 });
    const r = await service.handleCallback({ auth_code: 'c', state: 's' });
    expect(r).toContain('reason=invalid_state');
    expect(logger.warn).toHaveBeenCalledWith('fyers.oauth.failed', {
      reason: 'invalid_state',
    });
  });

  it('redirects with reason=fyers_error when exchangeAuthCode throws', async () => {
    const { service, logger } = buildService({
      clientOverride: {
        exchangeAuthCode: jest.fn(async () => {
          throw new Error('fyers 500');
        }) as any,
      },
    });
    const r = await service.handleCallback({ auth_code: 'c', state: 's' });
    expect(r).toContain('reason=fyers_error');
    expect(logger.warn).toHaveBeenCalledWith(
      'fyers.oauth.failed',
      expect.objectContaining({ reason: 'fyers_error' }),
    );
  });

  it('on success: upserts the singleton row with connectedByUserId from the consumed state', async () => {
    const { service, credentials, encryption, logger } = buildService({
      foundState: { userId: 'admin-7' },
    });

    const r = await service.handleCallback({ auth_code: 'c', state: 's' });
    expect(r).toContain('status=connected');
    expect(encryption.encrypt).toHaveBeenCalledWith('tok');

    const upsertCall = (credentials.upsert as jest.Mock).mock.calls[0];
    const row = upsertCall[0] as { singletonKey: string; connectedByUserId: string };
    const key = upsertCall[1] as string[];
    expect(row.singletonKey).toBe('active');
    expect(row.connectedByUserId).toBe('admin-7');
    expect(key).toEqual(['singletonKey']);
    expect(logger.info).toHaveBeenCalledWith('fyers.oauth.connected', {
      connectedByUserId: 'admin-7',
    });
  });

  it('never logs the token, auth_code, or state', async () => {
    const { service, logger } = buildService({
      foundState: { userId: 'u' },
    });
    await service.handleCallback({ auth_code: 'SECRET-CODE', state: 'SECRET-STATE' });

    const everyLogCall = [
      ...logger.info.mock.calls,
      ...logger.warn.mock.calls,
      ...logger.debug.mock.calls,
      ...logger.error.mock.calls,
    ];
    for (const call of everyLogCall) {
      const text = JSON.stringify(call);
      expect(text).not.toContain('SECRET-CODE');
      expect(text).not.toContain('SECRET-STATE');
      expect(text).not.toContain('tok');
    }
  });
});

describe('FyersAuthService.getStatus', () => {
  it('reports connected=false and nulls when no credential row exists', async () => {
    const { service } = buildService({ foundCredential: null });
    const s = await service.getStatus();
    expect(s).toEqual({
      connected: false,
      expiresAt: null,
      connectedByUserId: null,
      updatedAt: null,
    });
  });

  it('reports connected=true with expiresAt when a live token exists; never returns ciphertext', async () => {
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
    const updatedAt = new Date();
    const { service } = buildService({
      foundCredential: {
        encryptedToken: 'should-never-appear',
        iv: 'iv',
        authTag: 'tag',
        keyVersion: 1,
        expiresAt,
        updatedAt,
        connectedByUserId: 'admin-7',
      },
    });
    const s = await service.getStatus();
    expect(s.connected).toBe(true);
    expect(s.expiresAt).toBe(expiresAt.toISOString());
    expect(s.connectedByUserId).toBe('admin-7');
    expect(JSON.stringify(s)).not.toContain('should-never-appear');
    expect(JSON.stringify(s)).not.toContain('tag');
  });

  it('reports connected=false when the token has expired', async () => {
    const { service } = buildService({
      foundCredential: {
        encryptedToken: 'ct',
        iv: 'iv',
        authTag: 'tag',
        keyVersion: 1,
        expiresAt: new Date(Date.now() - 1000),
        updatedAt: new Date(),
        connectedByUserId: null,
      },
    });
    const s = await service.getStatus();
    expect(s.connected).toBe(false);
  });
});

describe('FyersAuthService.getDecryptedToken', () => {
  it('throws FYERS_TOKEN_MISSING when no row exists', async () => {
    const { service } = buildService({ foundCredential: null });
    await expect(service.getDecryptedToken()).rejects.toMatchObject({
      code: 'FYERS_TOKEN_MISSING',
      status: 404,
    });
  });

  it('throws FYERS_TOKEN_EXPIRED when the stored row is past expiresAt', async () => {
    const { service } = buildService({
      foundCredential: {
        encryptedToken: 'ct',
        iv: 'iv',
        authTag: 'tag',
        keyVersion: 1,
        expiresAt: new Date(Date.now() - 1000),
      },
    });
    await expect(service.getDecryptedToken()).rejects.toBeInstanceOf(
      FyersTokenError,
    );
    await expect(service.getDecryptedToken()).rejects.toMatchObject({
      code: 'FYERS_TOKEN_EXPIRED',
      status: 410,
    });
  });

  it('returns the decrypted token when a live row exists', async () => {
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
    const { service, encryption } = buildService({
      foundCredential: {
        encryptedToken: 'ct',
        iv: 'iv',
        authTag: 'tag',
        keyVersion: 1,
        expiresAt,
      },
    });
    const r = await service.getDecryptedToken();
    expect(encryption.decrypt).toHaveBeenCalledWith({
      encryptedToken: 'ct',
      iv: 'iv',
      authTag: 'tag',
      keyVersion: 1,
    });
    expect(r).toEqual({ accessToken: 'decrypted-token', expiresAt });
  });
});
