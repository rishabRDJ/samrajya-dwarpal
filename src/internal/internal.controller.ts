import {
  Controller,
  Get,
  GoneException,
  HttpException,
  NotFoundException,
  UseGuards,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Public } from '../auth/decorators/public.decorator.js';
import {
  FyersAuthService,
  FyersTokenError,
} from '../fyers/fyers-auth.service.js';
import { SystemAuthGuard } from './system-auth.guard.js';

// Service-to-service surface, not a user-facing one.
// @Public() skips the global JwtAuthGuard; SystemAuthGuard checks x-system-key
// instead. @ApiExcludeController() hides the route from /docs — the guard
// is the real defense, this just avoids advertising.
@Controller('internal')
@Public()
@UseGuards(SystemAuthGuard)
@ApiExcludeController()
export class InternalController {
  constructor(private readonly fyersAuth: FyersAuthService) {}

  // Translates the service's coded errors into the HTTP contract Diwan sees:
  //   missing row  → 404 FYERS_TOKEN_MISSING  (keep polling)
  //   expired row  → 410 FYERS_TOKEN_EXPIRED  (owner must log in again)
  // Decrypt failures bubble as InternalServerErrorException (generic 500).
  @Get('fyers-token')
  async fyersToken(): Promise<{ accessToken: string; expiresAt: string }> {
    try {
      const { accessToken, expiresAt } = await this.fyersAuth.getDecryptedToken();
      return { accessToken, expiresAt: expiresAt.toISOString() };
    } catch (err) {
      if (err instanceof FyersTokenError) {
        const body = { code: err.code, message: err.code };
        if (err.status === 404) throw new NotFoundException(body);
        if (err.status === 410) throw new GoneException(body);
      }
      if (err instanceof HttpException) throw err;
      throw err;
    }
  }
}
