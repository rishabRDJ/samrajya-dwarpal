import { applyDecorators } from '@nestjs/common';
import { Matches } from 'class-validator';
import { Trim } from './transforms.js';

// 10-digit Indian mobile number: first digit is 6-9, then exactly nine more
// digits. Deliberately NOT E.164 — the business is India-only and storing
// '+91...' everywhere would mean every lookup needs the prefix.
export const PHONE_REGEX = /^[6-9]\d{9}$/;

// Validates a trimmed 10-digit Indian mobile. Trim runs first because
// class-transformer applies transformers BEFORE validators; without it,
// '  9876543210  ' would fail the regex check.
//
// NOTE: pair with @IsOptional or @ValidateIf at the call site when the
// field itself is optional. This decorator only encodes the format rule.
export function IsIndianMobile(): PropertyDecorator {
  return applyDecorators(
    Trim(),
    Matches(PHONE_REGEX, {
      message: 'phoneNumber must be a 10-digit Indian mobile number',
    }),
  );
}
