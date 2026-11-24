import { QueryFailedError } from 'typeorm';

// Only recognised unique indexes on the users table. If a new unique
// constraint is added, extend this map AND add a 409 handler for it in
// the service — an unknown index must surface as 500, not a wrong 409.
const INDEX_TO_FIELD = {
  UQ_users_username: 'username',
  UQ_users_emailAddress: 'emailAddress',
  UQ_users_phoneNumber: 'phoneNumber',
} as const;

export type ConflictField = (typeof INDEX_TO_FIELD)[keyof typeof INDEX_TO_FIELD];

const MYSQL_DUP_ENTRY = 'ER_DUP_ENTRY';

interface DriverErrorShape {
  code?: string;
  sqlMessage?: string;
}

// Returns the DTO field name whose unique index collided, or undefined
// when:
//   * the error is not a duplicate-key error at all,
//   * the index name isn't one we recognise (caller must rethrow — an
//     unknown constraint must become 500, not a mislabelled 409).
export function conflictFieldFrom(err: unknown): ConflictField | undefined {
  if (!(err instanceof QueryFailedError)) return undefined;
  const driver = (err as QueryFailedError & { driverError?: DriverErrorShape }).driverError;
  if (driver?.code !== MYSQL_DUP_ENTRY) return undefined;
  const sqlMessage = driver.sqlMessage ?? '';
  for (const [index, field] of Object.entries(INDEX_TO_FIELD) as Array<
    [keyof typeof INDEX_TO_FIELD, ConflictField]
  >) {
    if (sqlMessage.includes(index)) return field;
  }
  return undefined;
}
