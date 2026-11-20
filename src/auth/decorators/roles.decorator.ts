import { SetMetadata } from '@nestjs/common';
import { UserRole } from '../../users/user.entity.js';

export const ROLES_KEY = 'roles';

// Attach to a handler to require the JWT's role claim to be one of these.
// Example: @Roles(UserRole.ADMIN) @Delete(':id') removeUser(...) {}
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);
