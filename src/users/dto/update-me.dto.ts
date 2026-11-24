import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, Length, Matches, ValidateIf } from 'class-validator';
import { Trim } from '../../common/validation/trim.decorator.js';

// E.164: a leading '+', then a non-zero digit, then up to 14 more digits.
// Max 15 total digits is the ITU spec. Matches '+919876543210', rejects
// '919876543210' (no +), '+0...' (leading zero), '+9...-...' (punctuation).
// Replaced by @IsIndianMobile() in step 3 of this PR.
const E164 = /^\+[1-9]\d{1,14}$/;

export class UpdateMeDto {
  @ApiProperty({ required: false, minLength: 1, maxLength: 100, example: 'Rishab' })
  @IsOptional()
  @Trim()
  @IsString()
  @Length(1, 100)
  firstName?: string;

  @ApiProperty({ required: false, minLength: 1, maxLength: 100, example: 'Jaiswal' })
  @IsOptional()
  @Trim()
  @IsString()
  @Length(1, 100)
  lastName?: string;

  // null clears the stored number; any other value must be E.164. Using
  // @ValidateIf (not @IsOptional) because we want validation to run on null
  // only up to "is it null" and then stop — not forward through @IsString.
  @ApiProperty({
    required: false,
    nullable: true,
    example: '+919876543210',
    description: 'E.164 format, or null to clear the stored number',
  })
  @ValidateIf((o: UpdateMeDto) => o.phoneNumber !== undefined && o.phoneNumber !== null)
  @IsString()
  @Matches(E164, { message: 'phoneNumber must be E.164 (e.g. +919876543210)' })
  phoneNumber?: string | null;
}
