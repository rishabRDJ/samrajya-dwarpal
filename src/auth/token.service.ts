import { randomBytes, createHash } from 'node:crypto';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService, JwtSignOptions } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { RefreshToken } from './refresh-token.entity.js';
import { UserRole } from '../users/user.entity.js';
import { TokenResponseDto } from './dto/token-response.dto.js';

export interface JwtPayload {
  sub: string;
  role: UserRole;
}

@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    @InjectRepository(RefreshToken)
    private readonly refreshRepo: Repository<RefreshToken>,
  ) {}

  async issueTokensForUser(user: { id: string; role: UserRole }): Promise<TokenResponseDto> {
    const accessToken = await this.signAccessToken(user);
    const { rawToken, expiresAt } = await this.mintAndStoreRefreshToken(user.id);
    return {
      accessToken,
      accessTokenExpiresIn: this.accessTokenTtlSeconds(),
      refreshToken: rawToken,
      refreshTokenExpiresAt: expiresAt.toISOString(),
    };
  }

  // Validates the incoming refresh token, atomically revokes it, and issues a
  // new pair. Reuse of an already-revoked token nukes every active session.
  // The revoke step is a conditional UPDATE so two concurrent /refresh calls
  // with the same raw token cannot both rotate successfully: exactly one wins,
  // the loser is treated as reuse.
  async rotate(rawRefreshToken: string, userLookup: (id: string) => Promise<{ id: string; role: UserRole } | null>): Promise<TokenResponseDto> {
    const tokenHash = this.hashToken(rawRefreshToken);
    const stored = await this.refreshRepo.findOne({ where: { tokenHash } });

    if (!stored) throw new UnauthorizedException();

    // Already-revoked at read time: a deliberate reuse attempt.
    if (stored.revokedAt !== null) {
      await this.revokeAllForUser(stored.userId);
      throw new UnauthorizedException();
    }

    if (stored.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedException();
    }

    const user = await userLookup(stored.userId);
    if (!user) throw new UnauthorizedException();

    // Atomic claim: only one caller can flip revokedAt from NULL to non-NULL
    // for this row. If affected === 0, a concurrent request beat us; treat
    // that exactly like reuse and burn every active session for the user.
    const result = await this.refreshRepo.update(
      { id: stored.id, revokedAt: IsNull() },
      { revokedAt: new Date() },
    );

    if (result.affected !== 1) {
      await this.revokeAllForUser(stored.userId);
      throw new UnauthorizedException();
    }

    return this.issueTokensForUser(user);
  }

  // Idempotent revoke. Unknown tokens succeed silently so the endpoint doesn't
  // leak whether a given token was ever valid.
  async revoke(rawRefreshToken: string): Promise<void> {
    const tokenHash = this.hashToken(rawRefreshToken);
    await this.refreshRepo.update(
      { tokenHash, revokedAt: IsNull() },
      { revokedAt: new Date() },
    );
  }

  private async signAccessToken(user: { id: string; role: UserRole }): Promise<string> {
    const payload: JwtPayload = { sub: user.id, role: user.role };
    const options: JwtSignOptions = {
      secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
      expiresIn: this.config.getOrThrow<string>('JWT_ACCESS_EXPIRES_IN') as JwtSignOptions['expiresIn'],
    };
    return this.jwt.signAsync(payload, options);
  }

  private async mintAndStoreRefreshToken(userId: string): Promise<{ rawToken: string; expiresAt: Date }> {
    const rawToken = randomBytes(64).toString('base64url');
    const tokenHash = this.hashToken(rawToken);
    const ttlDays = Number(this.config.getOrThrow<string>('REFRESH_TOKEN_TTL_DAYS'));
    const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000);

    await this.refreshRepo.save(
      this.refreshRepo.create({ userId, tokenHash, expiresAt }),
    );
    return { rawToken, expiresAt };
  }

  private async revokeAllForUser(userId: string): Promise<void> {
    await this.refreshRepo.update(
      { userId, revokedAt: IsNull() },
      { revokedAt: new Date() },
    );
  }

  private hashToken(raw: string): string {
    return createHash('sha256').update(raw).digest('hex');
  }

  private accessTokenTtlSeconds(): number {
    // Convert "15m" / "1h" / "900s" etc. to seconds for the response payload.
    // Clients prefer a number over having to parse the JWT's exp claim.
    const raw = this.config.getOrThrow<string>('JWT_ACCESS_EXPIRES_IN');
    const match = raw.match(/^(\d+)([smhd])$/);
    if (!match) return Number(raw);
    const [, n, unit] = match;
    const mult = { s: 1, m: 60, h: 3600, d: 86400 }[unit as 's' | 'm' | 'h' | 'd'];
    return Number(n) * mult;
  }
}
