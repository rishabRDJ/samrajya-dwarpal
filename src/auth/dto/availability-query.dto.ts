import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsString,
  Length,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { TrimLower } from '../../common/validation/transforms.js';

const USERNAME_REGEX = /^[a-zA-Z0-9._-]+$/;

// Exactly one of username or emailAddress is required. @ValidateIf on each
// field says "only run my validators when the OTHER field is missing," so:
//   - neither field set   → both fields' @IsString fire → 400
//   - only username set   → emailAddress validators skipped → 200 if valid
//   - only emailAddress   → username validators skipped → 200 if valid
//   - both set            → both run → the handler picks one
// Deliberately NO @IsOptional here; that decorator would short-circuit the
// check when a field is undefined and let empty queries through.
export class AvailabilityQueryDto {
  @ApiPropertyOptional({ example: 'rishab', minLength: 3, maxLength: 30 })
  @TrimLower()
  @ValidateIf((obj) => !obj.emailAddress)
  @IsString()
  @Length(3, 30)
  @Matches(USERNAME_REGEX, {
    message:
      'username must contain only letters, digits, dot, underscore, hyphen',
  })
  username?: string;

  @ApiPropertyOptional({ example: 'rishab@example.com', maxLength: 255 })
  @TrimLower()
  @ValidateIf((obj) => !obj.username)
  @IsEmail()
  @MaxLength(255)
  emailAddress?: string;
}
