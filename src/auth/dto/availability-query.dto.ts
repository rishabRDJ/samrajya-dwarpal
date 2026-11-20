import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsOptional, IsString, Length, Matches, MaxLength, ValidateIf } from 'class-validator';

const USERNAME_REGEX = /^[a-zA-Z0-9._-]+$/;

const normalize = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

// Exactly one of username or emailAddress is required. @ValidateIf flips each
// field from "optional" to "required+validated" when the other is absent, so
// an empty query body produces a clear 400, and a request supplying both is
// accepted (the handler picks whichever is set).
export class AvailabilityQueryDto {
  @ApiPropertyOptional({ example: 'rishab', minLength: 3, maxLength: 30 })
  @Transform(normalize)
  @ValidateIf((o) => !o.emailAddress)
  @IsString()
  @Length(3, 30)
  @Matches(USERNAME_REGEX)
  @IsOptional()
  username?: string;

  @ApiPropertyOptional({ example: 'rishab@example.com', maxLength: 255 })
  @Transform(normalize)
  @ValidateIf((o) => !o.username)
  @IsEmail()
  @MaxLength(255)
  @IsOptional()
  emailAddress?: string;
}
