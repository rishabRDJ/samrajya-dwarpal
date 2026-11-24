import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { PASSWORD_MAX } from '../../common/validation/password.js';
import { TrimLower } from '../../common/validation/transforms.js';

export class LoginDto {
  @ApiProperty({
    description: 'Email address or username. Trimmed and lowercased.',
    example: 'rishab@example.com',
    maxLength: 255,
  })
  @TrimLower()
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  identifier: string;

  // Login accepts any non-empty password string up to the shared maximum.
  // The length floor for a VALID password is enforced at register and
  // password-change time; login must never 400 on length (it would leak
  // that an account has or doesn't have a short password).
  @ApiProperty({
    description: 'Account password',
    example: 'correct horse battery staple',
    minLength: 1,
    maxLength: PASSWORD_MAX,
  })
  @IsString()
  @MinLength(1)
  @MaxLength(PASSWORD_MAX)
  password: string;
}
