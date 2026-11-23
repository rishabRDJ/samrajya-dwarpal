import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '../../users/user.entity.js';
import { UsersService } from '../../users/users.service.js';
import { ROLES_KEY } from '../decorators/roles.decorator.js';
import type { AuthenticatedUser } from '../jwt.strategy.js';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly users: UsersService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<UserRole[] | undefined>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );
    // No @Roles() marker: this guard has nothing to say. Skip the DB hit.
    if (!required || required.length === 0) return true;

    const user = context
      .switchToHttp()
      .getRequest<{ user?: AuthenticatedUser }>().user;
    if (!user) throw new UnauthorizedException();

    // Load the fresh role/status from the DB. The JWT carries a 15-minute
    // snapshot that cannot be invalidated mid-life; the DB is the source of
    // truth so demotion and deletion take effect immediately.
    const active = await this.users.findActiveById(user.id);
    if (!active) throw new UnauthorizedException(); // soft-deleted → 401
    if (!required.includes(active.role)) throw new ForbiddenException(); // wrong role → 403
    return true;
  }
}
