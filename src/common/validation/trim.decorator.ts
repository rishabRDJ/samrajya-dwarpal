import { Transform, type TransformFnParams } from 'class-transformer';

// Trims surrounding whitespace from a string. Does NOT change case — use
// @TrimLower() when you also need the value canonicalised to lowercase.
//
// Safe to apply to names and other free-text fields that the user chose
// (firstName, lastName). NEVER apply to a password: trimming a password
// silently changes the credential and would break round-trips with
// clients that preserve whitespace.
export function Trim(): PropertyDecorator {
  return Transform(({ value }: TransformFnParams) =>
    typeof value === 'string' ? value.trim() : value,
  );
}
