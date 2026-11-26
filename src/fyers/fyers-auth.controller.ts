import { Controller, Get, Query, Redirect } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiExcludeEndpoint,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Public } from '../auth/decorators/public.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import type { AuthenticatedUser } from '../auth/jwt.strategy.js';
import { UserRole } from '../users/user.entity.js';
import { FyersCallbackQueryDto } from './dto/fyers-callback.dto.js';
import { FyersAuthService } from './fyers-auth.service.js';

// Thin by design: each handler is one service call. Business rules
// (state consume, encrypt, upsert) live in FyersAuthService.
@ApiTags('fyers')
@Controller('auth/fyers')
export class FyersAuthController {
  constructor(private readonly service: FyersAuthService) {}

  // Admin-only. Starts a fresh login and returns the Fyers URL for the
  // Darbar "Connect Fyers" card to open in the owner's browser.
  @Roles(UserRole.ADMIN)
  @Get('login-url')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Mint a new OAuth state and return the Fyers authorise URL',
  })
  @ApiOkResponse({
    description: 'Fyers authorise URL to open in the owner browser',
    schema: {
      type: 'object',
      properties: { url: { type: 'string', format: 'uri' } },
      required: ['url'],
    },
  })
  @ApiResponse({ status: 401, description: 'Missing / invalid bearer token' })
  @ApiResponse({ status: 403, description: 'Caller is not an admin' })
  async loginUrl(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ url: string }> {
    return this.service.createLoginUrl(user.id);
  }

  // Public because the browser arrives from a Fyers redirect with no JWT.
  // The one-time state is the authentication here. Always a 302 to Darbar;
  // never JSON — so excluded from the OpenAPI schema (there is no JSON
  // response shape to document).
  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @Get('callback')
  @Redirect()
  @ApiExcludeEndpoint()
  async callback(
    @Query() query: FyersCallbackQueryDto,
  ): Promise<{ url: string; statusCode: 302 }> {
    const url = await this.service.handleCallback(query);
    return { url, statusCode: 302 };
  }

  // Admin-only read. Powers the "connected / not connected" badge in Darbar.
  @Roles(UserRole.ADMIN)
  @Get('status')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Report whether a live Fyers token is stored' })
  @ApiOkResponse({
    description: 'Current connection state; ciphertext is never returned.',
    schema: {
      type: 'object',
      properties: {
        connected: { type: 'boolean' },
        expiresAt: { type: 'string', format: 'date-time', nullable: true },
        connectedByUserId: { type: 'string', format: 'uuid', nullable: true },
        updatedAt: { type: 'string', format: 'date-time', nullable: true },
      },
      required: ['connected', 'expiresAt', 'connectedByUserId', 'updatedAt'],
    },
  })
  @ApiResponse({ status: 401, description: 'Missing / invalid bearer token' })
  @ApiResponse({ status: 403, description: 'Caller is not an admin' })
  async status() {
    return this.service.getStatus();
  }
}
