import { Transform, type TransformFnParams } from 'class-transformer';

// String-canonicalising transformers used from DTOs. class-transformer
// applies these BEFORE class-validator rules, so validation and the
// service both see the canonical form — and non-string inputs pass
// through untouched so a @ValidateIf / @IsOptional chain still sees
// null / undefined as-is.
//
// NEVER apply any of these to a password field. Silently altering user
// input would change the credential at write time and break login at
// read time if the client preserves the original value.

// Trims surrounding whitespace, nothing more.
export function Trim(): PropertyDecorator {
  return Transform(({ value }: TransformFnParams) =>
    typeof value === 'string' ? value.trim() : value,
  );
}

// Trims + lowercases. Use for identifiers the DB holds in a canonical
// lowercase form: username, emailAddress, and the login identifier.
export function TrimLower(): PropertyDecorator {
  return Transform(({ value }: TransformFnParams) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  );
}

// Trims + uppercases. Reserved for fields that are canonical UPPERCASE
// (e.g. country codes, ticker symbols); no current DTO needs it, but
// kept here so the three forms live together.
export function TrimUpper(): PropertyDecorator {
  return Transform(({ value }: TransformFnParams) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  );
}
