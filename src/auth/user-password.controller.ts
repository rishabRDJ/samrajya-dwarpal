import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from './decorators/current-user.decorator.js';
import { ChangePasswordDto } from './dto/change-password.dto.js';
import { TokenResponseDto } from './dto/token-response.dto.js';
import type { AuthenticatedUser } from './jwt.strategy.js';
import { AuthService } from './auth.service.js';

// Routed at /v1/users/me/password but lives in AuthModule so AuthService
// (which already has UsersService + TokenService) can orchestrate the
// transactional password + refresh-token rotation without a circular import
// between UsersModule and AuthModule. UsersController still owns the other
// /v1/users/me surface (GET, PATCH).
@ApiTags('users')
@ApiBearerAuth()
@Controller('users/me')
export class UserPasswordController {
  constructor(private readonly auth: AuthService) {}

  // Tighter throttle than the global baseline: password change is a
  // credential-manipulation endpoint, so a brute-force on `currentPassword`
  // through here should be rate-limited more aggressively. 5 attempts per
  // 60 seconds from any single client address is comfortable for a real user
  // who fat-fingers their old password once or twice.
  @Post('password')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Change the authenticated user password and rotate all sessions',
  })
  changePassword(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ChangePasswordDto,
  ): Promise<TokenResponseDto> {
    return this.auth.changePassword(user.id, {
      currentPassword: dto.currentPassword,
      newPassword: dto.newPassword,
    });
  }
}
