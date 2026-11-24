import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, Length, ValidateIf } from 'class-validator';
import { IsIndianMobile, PHONE_REGEX } from '../../common/validation/phone.js';
import { Trim } from '../../common/validation/transforms.js';

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

  // null clears the stored number; any other value must be a 10-digit
  // Indian mobile. Using @ValidateIf (not @IsOptional) so validation runs
  // on `null` only up to "is it null" and then stops — not forward through
  // @IsString.
  @ApiProperty({
    required: false,
    nullable: true,
    example: '9876543210',
    pattern: PHONE_REGEX.source,
    description:
      '10-digit Indian mobile number; must be unique. Pass null to clear the stored value.',
  })
  @ValidateIf((o: UpdateMeDto) => o.phoneNumber !== undefined && o.phoneNumber !== null)
  @IsString()
  @IsIndianMobile()
  phoneNumber?: string | null;
}
