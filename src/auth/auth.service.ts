import { Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
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
  ) {}

  async login(input: LoginInput): Promise<TokenResponseDto> {
    const found = await this.users.findForAuth(input.identifier);
    // Identical 401 for "unknown identifier" and "wrong password" so an
    // attacker cannot enumerate accounts by comparing responses.
    if (!found) throw new UnauthorizedException();

    const ok = await this.users.verifyPassword(found.passwordHash, input.password);
    if (!ok) throw new UnauthorizedException();

    const tokens = await this.tokens.issueTokensForUser({ id: found.id, role: found.role });
    // Best-effort audit field. Deliberately after issueTokensForUser so a DB
    // hiccup on this write cannot undo a successful login.
    await this.users.markLoggedIn(found.id);
    return tokens;
  }

  async refresh(rawRefreshToken: string): Promise<TokenResponseDto> {
    // TokenService receives a lookup callback so it does not depend on
    // UsersService at the module level. AuthService is the only place that
    // knows both and can wire them together.
    return this.tokens.rotate(rawRefreshToken, (id) => this.users.findActiveById(id));
  }

  // Verify the current password, atomically swap the hash and revoke all
  // refresh tokens, then issue a fresh pair. The transaction binds the
  // password update to the revocation so a failure cannot leave old refresh
  // tokens usable with the new password. The fresh pair is minted AFTER the
  // transaction commits so a transient failure never leaks a token the user
  // thinks they have but we lost. argon2 hashing runs BEFORE the transaction
  // because it is CPU-bound (~50-200ms) and we do not want to hold a DB
  // transaction open that long.
  async changePassword(
    userId: string,
    input: ChangePasswordInput,
  ): Promise<TokenResponseDto> {
    const found = await this.users.getPasswordContext(userId);
    if (!found) throw new UnauthorizedException();

    const ok = await this.users.verifyPassword(found.passwordHash, input.currentPassword);
    if (!ok) throw new UnauthorizedException();

    const newHash = await this.users.hashPassword(input.newPassword);

    await this.dataSource.transaction(async (em) => {
      await this.users.updatePasswordHash(userId, newHash, em);
      await this.tokens.revokeAllForUser(userId, em);
    });

    return this.tokens.issueTokensForUser({ id: found.id, role: found.role });
  }
}
