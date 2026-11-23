import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { UsersModule } from '../users/users.module.js';
import { AdminUsersController } from './admin-users.controller.js';
import { AdminUsersService } from './admin-users.service.js';

// AdminModule depends on UsersModule (for the User repo, re-exported via
// TypeOrmModule) and AuthModule (for TokenService.revokeAllForUser). Neither
// of those modules depends on AdminModule, so no forwardRef is needed.
@Module({
  imports: [UsersModule, AuthModule],
  controllers: [AdminUsersController],
  providers: [AdminUsersService],
})
export class AdminModule {}
