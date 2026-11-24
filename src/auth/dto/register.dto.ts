import { ApiProperty } from '@nestjs/swagger';
import {
  IsEmail,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
} from 'class-validator';
import {
  IsPassword,
  PASSWORD_MAX,
  PASSWORD_MIN,
} from '../../common/validation/password.js';
import { Trim } from '../../common/validation/trim.decorator.js';
import { TrimLower } from '../../common/validation/trim-lower.decorator.js';

// Username character set: letters, digits, dot, underscore, hyphen. The `@`
// symbol is deliberately excluded so /auth/login can disambiguate email vs.
// username by the presence of `@`.
const USERNAME_REGEX = /^[a-zA-Z0-9._-]+$/;

export class RegisterDto {
  @ApiProperty({
    description:
      'Letters, digits, dot, underscore, hyphen. Trimmed and lowercased on save.',
    example: 'rishab.jaiswal',
    minLength: 3,
    maxLength: 30,
  })
  @TrimLower()
  @IsString()
  @Length(3, 30)
  @Matches(USERNAME_REGEX, {
    message:
      'username must contain only letters, digits, dot, underscore, hyphen',
  })
  username: string;

  @ApiProperty({ example: 'rishab@example.com', maxLength: 255 })
  @TrimLower()
  @IsEmail()
  @MaxLength(255)
  emailAddress: string;

  @ApiProperty({ example: 'Rishab', maxLength: 100 })
  @Trim()
  @IsString()
  @Length(1, 100)
  firstName: string;

  @ApiProperty({ example: 'Jaiswal', maxLength: 100 })
  @Trim()
  @IsString()
  @Length(1, 100)
  lastName: string;

  @ApiProperty({
    description: 'Argon2id-hashed on the server. Never stored or logged raw.',
    minLength: PASSWORD_MIN,
    maxLength: PASSWORD_MAX,
  })
  @IsPassword()
  password: string;

  @ApiProperty({
    required: false,
    maxLength: 20,
    example: null,
    nullable: true,
  })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  phoneNumber?: string;
}
