import { Transform, type TransformFnParams } from 'class-transformer';

// Trims surrounding whitespace AND lowercases the string. Use for
// identifiers that the DB holds in a case-insensitive canonical form:
// username, emailAddress, and the login identifier (which is one of those
// two).
//
// class-transformer runs transforms BEFORE class-validator rules, so
// validation and the service both see the canonical form — no need to
// re-normalise at the DB layer except as defense in depth (the User
// entity's @BeforeInsert hook still lowercases, in case a future code
// path ever calls repository.save with a non-DTO input).
//
// NEVER apply to a password field: any transformation that silently
// alters user input would change the credential at write time and
// break login at read time when the client keeps the original casing.
export function TrimLower(): PropertyDecorator {
  return Transform(({ value }: TransformFnParams) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  );
}
