import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  toUserResponse,
  UserResponseDto,
} from '../users/dto/user-response.dto.js';
import { UsersService } from '../users/users.service.js';
import { AuthService } from './auth.service.js';
import { Public } from './decorators/public.decorator.js';
import { AvailabilityQueryDto } from './dto/availability-query.dto.js';
import { AvailabilityResponseDto } from './dto/availability-response.dto.js';
import { LoginDto } from './dto/login.dto.js';
import { RefreshDto } from './dto/refresh.dto.js';
import { RegisterDto } from './dto/register.dto.js';
import { TokenResponseDto } from './dto/token-response.dto.js';
import { TokenService } from './token.service.js';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly users: UsersService,
    private readonly tokens: TokenService,
  ) {}

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Log in with email or username + password' })
  @ApiResponse({ status: 200, type: TokenResponseDto })
  @ApiResponse({ status: 401, description: 'Invalid credentials' })
  login(@Body() dto: LoginDto): Promise<TokenResponseDto> {
    return this.auth.login({
      identifier: dto.identifier,
      password: dto.password,
    });
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
  refresh(@Body() dto: RefreshDto): Promise<TokenResponseDto> {
    return this.auth.refresh(dto.refreshToken);
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
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @ApiOperation({ summary: 'Create a new account' })
  @ApiResponse({ status: 201, type: UserResponseDto })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({
    status: 409,
    description:
      'Field already taken. body.conflictField names the field: "username" | "emailAddress" | "phoneNumber".',
  })
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
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Check if a username or email address is free to register',
    description: 'Exactly one of username or emailAddress must be provided.',
  })
  @ApiResponse({ status: 200, type: AvailabilityResponseDto })
  @ApiResponse({
    status: 400,
    description: 'Neither field supplied or input malformed',
  })
  async availability(
    @Query() query: AvailabilityQueryDto,
  ): Promise<AvailabilityResponseDto> {
    const available = await this.users.isAvailable({
      username: query.username,
      emailAddress: query.emailAddress,
    });
    return { available };
  }
}
