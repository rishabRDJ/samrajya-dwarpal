import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiOperation, ApiProperty, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { toUserResponse, UserResponseDto } from '../users/dto/user-response.dto.js';
import { UsersService } from '../users/users.service.js';
import { Public } from './decorators/public.decorator.js';
import { AvailabilityQueryDto } from './dto/availability-query.dto.js';
import { LoginDto } from './dto/login.dto.js';
import { RefreshDto } from './dto/refresh.dto.js';
import { RegisterDto } from './dto/register.dto.js';
import { TokenResponseDto } from './dto/token-response.dto.js';
import { TokenService } from './token.service.js';

export class AvailabilityResponseDto {
  @ApiProperty({ example: true })
  available: boolean;
}

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly tokens: TokenService,
    private readonly users: UsersService,
  ) {}

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  // 5 attempts per minute per IP. The ThrottlerModule config (step 7) wires
  // the actual enforcement; this decorator carries the per-route override.
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Log in with email or username + password' })
  @ApiResponse({ status: 200, type: TokenResponseDto })
  @ApiResponse({ status: 401, description: 'Invalid credentials' })
  async login(@Body() dto: LoginDto): Promise<TokenResponseDto> {
    const found = await this.users.findForAuth(dto.identifier);
    // Same 401 for "unknown user" and "wrong password" so an attacker cannot
    // enumerate valid accounts by comparing responses.
    if (!found) throw new UnauthorizedException();

    const ok = await this.users.verifyPassword(
      found.passwordHash,
      dto.password,
    );
    if (!ok) throw new UnauthorizedException();

    const tokens = await this.tokens.issueTokensForUser({
      id: found.id,
      role: found.role,
    });
    // Best-effort audit field; a failure here must not undo token issuance.
    await this.users.markLoggedIn(found.id);
    return tokens;
  }

  @Public() // skip JWT auth, the route has its own gate.
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Rotate a refresh token for a new access + refresh pair',
  })
  @ApiResponse({ status: 200, type: TokenResponseDto })
  @ApiResponse({
    status: 401,
    description: 'Invalid, expired, or revoked token',
  })
  async refresh(@Body() dto: RefreshDto): Promise<TokenResponseDto> {
    // TokenService takes a lookup callback so it does not depend on
    // UsersService. Controller is the only place that knows both.
    return this.tokens.rotate(dto.refreshToken, (id) =>
      this.users.findActiveById(id),
    );
  }

  @Public() // skip JWT auth, the route has its own gate.
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Revoke a refresh token (idempotent)' })
  @ApiResponse({
    status: 204,
    description: 'Token revoked (or was never valid)',
  })
  async logout(@Body() dto: RefreshDto): Promise<void> {
    await this.tokens.revoke(dto.refreshToken);
  }

  @Public()
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  // Tighter than the baseline (3/min) because registration is relatively
  // expensive (argon2 hash) and a juicy spam target.
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @ApiOperation({ summary: 'Create a new account' })
  @ApiResponse({ status: 201, type: UserResponseDto })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 409, description: 'username or email address already in use' })
  async register(@Body() dto: RegisterDto): Promise<UserResponseDto> {
    const user = await this.users.register({
      username: dto.username,
      emailAddress: dto.emailAddress,
      firstName: dto.firstName,
      lastName: dto.lastName,
      password: dto.password,
      phoneNumber: dto.phoneNumber,
    });
    return toUserResponse(user);
  }

  @Public()
  @Get('availability')
  // Chatty endpoint (typed into on every form blur) so a higher ceiling than
  // register. Still bounded to deter brute-force enumeration.
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Check if a username or email address is free to register',
    description: 'Exactly one of username or emailAddress must be provided.',
  })
  @ApiResponse({ status: 200, type: AvailabilityResponseDto })
  @ApiResponse({ status: 400, description: 'Neither field supplied or input malformed' })
  async availability(@Query() query: AvailabilityQueryDto): Promise<AvailabilityResponseDto> {
    const available = await this.users.isAvailable({
      username: query.username,
      emailAddress: query.emailAddress,
    });
    return { available };
  }
}
