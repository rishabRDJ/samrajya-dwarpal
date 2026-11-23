import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';
import { UserRole } from '../../users/user.entity.js';

// PATCH /v1/admin/users/:id/role body. Only the role field is accepted; any
// other key is rejected by the global ValidationPipe.forbidNonWhitelisted.
export class UpdateRoleDto {
  @ApiProperty({ enum: UserRole, example: UserRole.ADMIN })
  @IsEnum(UserRole)
  role: UserRole;
}
