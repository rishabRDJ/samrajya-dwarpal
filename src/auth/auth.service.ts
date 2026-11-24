import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { ScopedLogger } from '../common/logging/scoped-logger.js';
import { UsersService } from '../users/users.service.js';
import { TokenResponseDto } from './dto/token-response.dto.js';
import { TokenService } from './token.service.js';

// Plain structural input. The controller maps its LoginDto to this shape so
// AuthService stays free of HTTP concerns (class-validator decorators,
// @ApiProperty, etc.). A future v2 controller with a different DTO shape can
// still call the same service by providing this interface.
export interface LoginInput {
  identifier: string;
  password: string;
}

export interface ChangePasswordInput {
  currentPassword: string;
  newPassword: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UsersService,
    private readonly tokens: TokenService,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly logger: ScopedLogger,
  ) {
    this.logger.forClass(AuthService.name);
  }

  async login(input: LoginInput): Promise<TokenResponseDto> {
    const log = this.logger.in('login');
    const identifierType = input.identifier.includes('@') ? 'email' : 'username';

    const found = await this.users.findForAuth(input.identifier);
    // Identical 401 for "unknown identifier" and "wrong password" so an
    // attacker cannot enumerate accounts by comparing responses.
    if (!found) {
      log.warn('auth.login.failed', {
        reason: 'unknown_identifier',
        identifierType,
        identifier: input.identifier,
      });
      throw new UnauthorizedException();
    }

    const ok = await this.users.verifyPassword(found.passwordHash, input.password);
    if (!ok) {
      log.warn('auth.login.failed', {
        reason: 'wrong_password',
        identifierType,
        identifier: input.identifier,
        userId: found.id,
      });
      throw new UnauthorizedException();
    }

    const tokens = await this.tokens.issueTokensForUser({ id: found.id, role: found.role });
    // Best-effort audit field. Deliberately after issueTokensForUser so a DB
    // hiccup on this write cannot undo a successful login.
    await this.users.markLoggedIn(found.id);
    log.info('auth.login.succeeded', { userId: found.id });
    return tokens;
  }

  async refresh(rawRefreshToken: string): Promise<TokenResponseDto> {
    // TokenService receives a lookup callback so it does not depend on
    // UsersService at the module level. AuthService is the only place that
    // knows both and can wire them together.
    return this.tokens.rotate(rawRefreshToken, (id) => this.users.findActiveById(id));
  }

  // Verify the current password, atomically swap the hash and revoke all
  // refresh tokens, then issue a fresh pair. Three invariants to notice:
  //   1. Hash is computed BEFORE the transaction opens. argon2 is CPU-bound
  //      (~50-200ms); we never hold a DB transaction open for that.
  //   2. The UPDATE is a compare-and-set against the hash we verified. If
  //      the row was mutated between verify and update (concurrent
  //      self-change, future admin reset, direct SQL) the UPDATE matches
  //      zero rows and we throw 409 — we do NOT overwrite the fresh value.
  //   3. The fresh pair is minted AFTER the transaction commits so a
  //      transient failure never leaks a token we then roll back.
  async changePassword(
    userId: string,
    input: ChangePasswordInput,
  ): Promise<TokenResponseDto> {
    const log = this.logger.in('changePassword');

    // Early, cheap rejection: refusing "same as current" before argon2
    // saves the user 100ms and side-steps the question of whether 400 or
    // 401 wins on same-wrong-same inputs.
    if (input.currentPassword === input.newPassword) {
      log.warn('user.password.change_failed', {
        userId,
        reason: 'same_as_current',
      });
      throw new BadRequestException('new password must differ from current password');
    }

    const found = await this.users.getPasswordContext(userId);
    if (!found) {
      log.warn('user.password.change_failed', { userId, reason: 'wrong_current' });
      throw new UnauthorizedException();
    }

    const ok = await this.users.verifyPassword(found.passwordHash, input.currentPassword);
    if (!ok) {
      log.warn('user.password.change_failed', { userId, reason: 'wrong_current' });
      throw new UnauthorizedException();
    }

    const newHash = await this.users.hashPassword(input.newPassword);

    await this.dataSource.transaction(async (em) => {
      const swapped = await this.users.updatePasswordHash(
        userId,
        found.passwordHash,
        newHash,
        em,
      );
      if (!swapped) {
        log.warn('user.password.change_failed', {
          userId,
          reason: 'concurrent_change',
        });
        throw new ConflictException(
          'password was changed by another process; try again',
        );
      }
      await this.tokens.revokeAllForUser(userId, em);
    });

    log.info('user.password.changed', { userId });
    return this.tokens.issueTokensForUser({ id: found.id, role: found.role });
  }
}
