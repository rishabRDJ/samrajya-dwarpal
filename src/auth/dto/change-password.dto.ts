import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';
import {
  IsPassword,
  PASSWORD_MAX,
  PASSWORD_MIN,
} from '../../common/validation/password.js';

// POST /v1/users/me/password body.
//
// currentPassword: any non-empty string up to PASSWORD_MAX — it's only
// ever passed to argon2.verify. The real length floor is the stored hash,
// not a DTO check. The upper bound protects CPU from a megabyte payload.
//
// newPassword: enforces the shared password rules (@IsPassword) so register
// and password-change can never disagree on what a valid password looks
// like.
export class ChangePasswordDto {
  @ApiProperty({
    example: 'current password here',
    minLength: 1,
    maxLength: PASSWORD_MAX,
  })
  @IsString()
  @MinLength(1)
  @MaxLength(PASSWORD_MAX)
  currentPassword: string;

  @ApiProperty({
    example: 'a new sufficiently long password',
    minLength: PASSWORD_MIN,
    maxLength: PASSWORD_MAX,
  })
  @IsPassword()
  newPassword: string;
}
