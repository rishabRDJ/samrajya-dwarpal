import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

// POST /v1/users/me/password body. Current password is a plain string (any
// length) because we're only going to argon2.verify it — the storage format
// already guarantees length/entropy. New password enforces the same floor as
// RegisterDto (12 chars) and a sane upper bound so a one-megabyte payload
// cannot pin a CPU on argon2 hashing.
export class ChangePasswordDto {
  @ApiProperty({ example: 'current password here' })
  @IsString()
  currentPassword: string;

  @ApiProperty({
    example: 'a new sufficiently long password',
    minLength: 12,
    maxLength: 128,
  })
  @IsString()
  @MinLength(12)
  @MaxLength(128)
  newPassword: string;
}
