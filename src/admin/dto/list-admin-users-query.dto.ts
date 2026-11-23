import { ApiProperty } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';
import { UserRole } from '../../users/user.entity.js';

export enum UserListStatus {
  ACTIVE = 'active',
  DELETED = 'deleted',
  ALL = 'all',
}

// GET /v1/admin/users?... query. Note: query-string values arrive as strings;
// @Type(() => Number) + the ValidationPipe's `transform: true` coerce
// `?page=2` into page: 2. @Transform on q trims and canonicalizes the search
// to lowercase so it matches the stored (lowercased) username/email.
export class ListAdminUsersQueryDto {
  @ApiProperty({ required: false, default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiProperty({ required: false, default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20;

  @ApiProperty({
    required: false,
    description: 'Case-insensitive prefix search on username or emailAddress',
  })
  @IsOptional()
  @IsString()
  @Length(1, 255)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  q?: string;

  @ApiProperty({ required: false, enum: UserRole })
  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;

  @ApiProperty({
    required: false,
    enum: UserListStatus,
    default: UserListStatus.ACTIVE,
    description: 'active = deletedAt IS NULL, deleted = deletedAt IS NOT NULL, all = both',
  })
  @IsOptional()
  @IsEnum(UserListStatus)
  status: UserListStatus = UserListStatus.ACTIVE;
}
