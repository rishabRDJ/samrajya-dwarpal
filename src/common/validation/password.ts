import { applyDecorators } from '@nestjs/common';
import { IsString, MaxLength, MinLength } from 'class-validator';

// Single source of truth for password length. Register, change-password
// and any future password-setting DTO must use these constants — they are
// also fed to @ApiProperty so /docs stays in sync automatically.
//
// NOT used by login or the current-password check: those need any
// non-empty string (the stored hash enforces the real floor already).
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;

// Combined decorator for fields that SET a password. Equivalent to
// @IsString() @MinLength(PASSWORD_MIN) @MaxLength(PASSWORD_MAX) but reads
// in one line at the call site and cannot drift across DTOs.
export function IsPassword(): PropertyDecorator {
  return applyDecorators(
    IsString(),
    MinLength(PASSWORD_MIN),
    MaxLength(PASSWORD_MAX),
  );
}
