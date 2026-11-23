import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import type { AuthenticatedUser } from '../auth/jwt.strategy.js';
import { toUserResponse, UserResponseDto } from '../users/dto/user-response.dto.js';
import { UserRole } from '../users/user.entity.js';
import { AdminUsersService } from './admin-users.service.js';
import { ListAdminUsersQueryDto } from './dto/list-admin-users-query.dto.js';
import { PaginatedUsersDto } from './dto/paginated-users.dto.js';
import { UpdateRoleDto } from './dto/update-role.dto.js';

// Routes are protected app-wide by JwtAuthGuard (opt-out with @Public) and
// by RolesGuard (fires when @Roles() is present). A single class-level
// @Roles(ADMIN) covers all four handlers so no one accidentally forgets it
// on a new route.
@ApiTags('admin / users')
@ApiBearerAuth()
@Roles(UserRole.ADMIN)
@Controller('admin/users')
export class AdminUsersController {
  constructor(private readonly service: AdminUsersService) {}

  @Get()
  @ApiOperation({ summary: 'List users (paginated) with optional filters' })
  list(@Query() query: ListAdminUsersQueryDto): Promise<PaginatedUsersDto> {
    return this.service.list(query);
  }

  @Patch(':id/role')
  @ApiOperation({ summary: "Change a user's role" })
  async setRole(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: UpdateRoleDto,
  ): Promise<UserResponseDto> {
    const updated = await this.service.setRole(actor.id, id, dto.role);
    return toUserResponse(updated);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Soft-delete a user and revoke every session' })
  async softDelete(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ): Promise<void> {
    await this.service.softDelete(actor.id, id);
  }

  @Patch(':id/restore')
  @ApiOperation({ summary: 'Restore a soft-deleted user' })
  async restore(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ): Promise<UserResponseDto> {
    const restored = await this.service.restore(actor.id, id);
    return toUserResponse(restored);
  }
}
