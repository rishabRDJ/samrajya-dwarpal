import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'node:crypto';
import { DataSource, LessThan, Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { EncryptionService } from '../common/crypto/encryption.service.js';
import { ScopedLogger } from '../common/logging/scoped-logger.js';
import type { FyersCallbackQueryDto } from './dto/fyers-callback.dto.js';
import { FyersClient } from './fyers.client.js';
import { FyersCredential } from './fyers-credential.entity.js';
import { FyersOauthState } from './fyers-oauth-state.entity.js';

// Return shape of /callback is always a redirect URL. The controller turns
// this string into a 302.
export type CallbackOutcome =
  | { status: 'connected' }
  | { status: 'error'; reason: 'denied' | 'invalid_state' | 'fyers_error' };

const STATE_TTL_MS = 10 * 60 * 1000;
const STATE_STALE_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class FyersAuthService {
  private readonly darbarUrl: string;

  constructor(
    private readonly client: FyersClient,
    private readonly encryption: EncryptionService,
    private readonly logger: ScopedLogger,
    config: ConfigService,
    @InjectRepository(FyersOauthState)
    private readonly states: Repository<FyersOauthState>,
    @InjectRepository(FyersCredential)
    private readonly credentials: Repository<FyersCredential>,
    private readonly dataSource: DataSource,
  ) {
    this.logger.forClass('FyersAuthService');
    this.darbarUrl = config.getOrThrow<string>('DARBAR_APP_URL');
  }

  // Issue a fresh state, store its hash, return the Fyers URL. Also sweeps
  // stale state rows opportunistically so we avoid a dedicated cron job.
  async createLoginUrl(userId: string): Promise<{ url: string }> {
    await this.states.delete({
      expiresAt: LessThan(new Date(Date.now() - STATE_STALE_MS)),
    });

    const raw = randomBytes(32).toString('hex');
    const stateHash = hashState(raw);

    await this.states.insert({
      stateHash,
      userId,
      expiresAt: new Date(Date.now() + STATE_TTL_MS),
    });

    this.logger.in('createLoginUrl').info('fyers.oauth.started', { userId });
    return { url: this.client.buildAuthUrl(raw) };
  }

  // Validate state (single-use UPDATE), exchange code, encrypt, upsert.
  // Returns a redirect URL for the controller to 302 to.
  async handleCallback(q: FyersCallbackQueryDto): Promise<string> {
    const log = this.logger.in('handleCallback');

    if (q.s === 'error' || !q.auth_code || !q.state) {
      log.warn('fyers.oauth.failed', { reason: 'denied' });
      return this.redirect({ status: 'error', reason: 'denied' });
    }

    const stateHash = hashState(q.state);
    const now = new Date();

    // Single-use consume: only one UPDATE wins; replays and expired states
    // both change zero rows.
    const result = await this.states
      .createQueryBuilder()
      .update(FyersOauthState)
      .set({ usedAt: now })
      .where('stateHash = :stateHash', { stateHash })
      .andWhere('usedAt IS NULL')
      .andWhere('expiresAt > :now', { now })
      .execute();

    if (result.affected !== 1) {
      log.warn('fyers.oauth.failed', { reason: 'invalid_state' });
      return this.redirect({ status: 'error', reason: 'invalid_state' });
    }

    // Find the userId that initiated this login (for audit).
    const consumed = await this.states.findOneBy({ stateHash });
    const connectedByUserId = consumed?.userId ?? null;

    let accessToken: string;
    try {
      ({ accessToken } = await this.client.exchangeAuthCode(q.auth_code));
    } catch (err) {
      log.warn('fyers.oauth.failed', {
        reason: 'fyers_error',
        err: (err as Error).message,
      });
      return this.redirect({ status: 'error', reason: 'fyers_error' });
    }

    const payload = this.encryption.encrypt(accessToken);
    const expiresAt = deriveExpiresAt(accessToken);

    await this.credentials.upsert(
      {
        singletonKey: 'active',
        connectedByUserId,
        encryptedToken: payload.encryptedToken,
        iv: payload.iv,
        authTag: payload.authTag,
        keyVersion: payload.keyVersion,
        expiresAt,
      },
      ['singletonKey'],
    );

    log.info('fyers.oauth.connected', { connectedByUserId });
    return this.redirect({ status: 'connected' });
  }

  // Admin dashboard read. Never returns ciphertext.
  async getStatus(): Promise<{
    connected: boolean;
    expiresAt: string | null;
    connectedByUserId: string | null;
    updatedAt: string | null;
  }> {
    const row = await this.credentials.findOneBy({ singletonKey: 'active' });
    const connected = !!row && row.expiresAt.getTime() > Date.now();
    return {
      connected,
      expiresAt: row ? row.expiresAt.toISOString() : null,
      connectedByUserId: row?.connectedByUserId ?? null,
      updatedAt: row ? row.updatedAt.toISOString() : null,
    };
  }

  // Diwan calls this through the internal endpoint. Lives here, not in the
  // internal module, so one service owns all Fyers state.
  async getDecryptedToken(): Promise<{ accessToken: string; expiresAt: Date }> {
    const log = this.logger.in('getDecryptedToken');
    const row = await this.credentials.findOneBy({ singletonKey: 'active' });
    if (!row) {
      log.warn('fyers.token.missing', { caller: 'diwan' });
      // Thrown codes are translated to HTTP by the internal controller.
      throw new FyersTokenError('FYERS_TOKEN_MISSING', 404);
    }
    if (row.expiresAt.getTime() <= Date.now()) {
      log.warn('fyers.token.expired', { caller: 'diwan' });
      throw new FyersTokenError('FYERS_TOKEN_EXPIRED', 410);
    }
    const accessToken = this.encryption.decrypt({
      encryptedToken: row.encryptedToken,
      iv: row.iv,
      authTag: row.authTag,
      keyVersion: row.keyVersion,
    });
    log.info('fyers.token.served', { caller: 'diwan' });
    return { accessToken, expiresAt: row.expiresAt };
  }

  private redirect(outcome: CallbackOutcome): string {
    const url = new URL(`${this.darbarUrl}/dashboard`);
    url.searchParams.set('status', outcome.status);
    if (outcome.status === 'error') {
      url.searchParams.set('reason', outcome.reason);
    }
    return url.toString();
  }
}

// Shared helper so /login-url and /callback hash identically. Any drift here
// means every callback silently redirects to invalid_state.
export function hashState(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

// Every stored Fyers token expires at or before 23:59:59.999 UTC today —
// the last tick of the current UTC calendar day — so the DB literally shows
// `YYYY-MM-DD 23:59:59` on today's date. Fyers's own JWT exp is the upper
// bound; our end-of-day is the hard cap. min() of the two is strictly safer.
export function deriveExpiresAt(accessToken: string): Date {
  const cap = endOfTodayUtc();

  const parts = accessToken.split('.');
  if (parts.length === 3) {
    try {
      const payloadJson = Buffer.from(parts[1], 'base64url').toString('utf8');
      const payload = JSON.parse(payloadJson) as { exp?: number };
      if (payload.exp) {
        const jwtExp = new Date(payload.exp * 1000);
        return jwtExp < cap ? jwtExp : cap;
      }
    } catch {
      /* fall through to the cap */
    }
  }
  return cap;
}

// 23:59:59.999 UTC today — one millisecond before midnight UTC.
export function endOfTodayUtc(now: Date = new Date()): Date {
  const end = new Date(now);
  end.setUTCHours(23, 59, 59, 999);
  return end;
}

// Coded error the internal controller unpacks into 404/410.
export class FyersTokenError extends Error {
  constructor(
    public readonly code: 'FYERS_TOKEN_MISSING' | 'FYERS_TOKEN_EXPIRED',
    public readonly status: 404 | 410,
  ) {
    super(code);
  }
}
