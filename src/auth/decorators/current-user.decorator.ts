import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { AuthenticatedUser } from '../jwt.strategy.js';

// Pulls the authenticated user off the request. JwtStrategy.validate() is what
// put it there, so this only works on routes that went through JwtAuthGuard.
// On @Public() routes the request has no user; callers of @CurrentUser() on
// public routes will see undefined.
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedUser | undefined => {
    return ctx.switchToHttp().getRequest<{ user?: AuthenticatedUser }>().user;
  },
);
