import { Injectable, UnauthorizedException } from '@nestjs/common';
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

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UsersService,
    private readonly tokens: TokenService,
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
}
