import { Body, Controller, Get, HttpCode, HttpStatus, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/jwt.strategy.js';
import { UpdateMeDto } from './dto/update-me.dto.js';
import { toUserResponse, UserResponseDto } from './dto/user-response.dto.js';
import { UsersService } from './users.service.js';

@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  // GET /v1/users/me — full profile loaded fresh from the DB. The JWT only
  // carries id + role, and role may be stale (see RolesGuard). Clients that
  // want the whole profile must read it here.
  @Get('me')
  @ApiOperation({ summary: 'Return the authenticated user profile' })
  async me(@CurrentUser() user: AuthenticatedUser): Promise<UserResponseDto> {
    const profile = await this.users.getActiveProfile(user.id);
    return toUserResponse(profile);
  }

  // PATCH /v1/users/me — self-service update of firstName, lastName and
  // phoneNumber only. Any other field (role, username, emailAddress, password)
  // is rejected by the global ValidationPipe's forbidNonWhitelisted → 400.
  @Patch('me')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Update the authenticated user profile' })
  @ApiResponse({ status: 200, type: UserResponseDto })
  @ApiResponse({ status: 400, description: 'Empty body, unknown field or invalid value' })
  @ApiResponse({
    status: 409,
    description:
      'phoneNumber already in use; body.conflictField is "phoneNumber".',
  })
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateMeDto,
  ): Promise<UserResponseDto> {
    const updated = await this.users.updateProfile(user.id, {
      firstName: dto.firstName,
      lastName: dto.lastName,
      phoneNumber: dto.phoneNumber,
    });
    return toUserResponse(updated);
  }
}
