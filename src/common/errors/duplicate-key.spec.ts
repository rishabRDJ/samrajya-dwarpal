import 'reflect-metadata';
import { QueryFailedError } from 'typeorm';
import { conflictFieldFrom } from './duplicate-key.js';

function mkDupError(sqlMessage: string): QueryFailedError {
  const err = new QueryFailedError('q', [], new Error('dup'));
  // driverError is typed as `Error` on QueryFailedError. We attach a shape
  // that mysql2 actually produces in production (plain Error + code + sqlMessage).
  Object.assign(err.driverError, { code: 'ER_DUP_ENTRY', sqlMessage });
  return err;
}

describe('conflictFieldFrom', () => {
  it('maps UQ_users_username to username', () => {
    expect(
      conflictFieldFrom(
        mkDupError("Duplicate entry 'rishab' for key 'UQ_users_username'"),
      ),
    ).toBe('username');
  });

  it('maps UQ_users_emailAddress to emailAddress', () => {
    expect(
      conflictFieldFrom(
        mkDupError("Duplicate entry 'rishab@example.com' for key 'UQ_users_emailAddress'"),
      ),
    ).toBe('emailAddress');
  });

  it('maps UQ_users_phoneNumber to phoneNumber', () => {
    expect(
      conflictFieldFrom(
        mkDupError("Duplicate entry '9876543210' for key 'UQ_users_phoneNumber'"),
      ),
    ).toBe('phoneNumber');
  });

  it('returns undefined for an unrecognised index', () => {
    expect(
      conflictFieldFrom(
        mkDupError("Duplicate entry 'x' for key 'UQ_users_somethingElse'"),
      ),
    ).toBeUndefined();
  });

  it('returns undefined when the driver error code is not ER_DUP_ENTRY', () => {
    const err = new QueryFailedError('q', [], new Error('x'));
    Object.assign(err.driverError, { code: 'ER_LOCK_DEADLOCK', sqlMessage: 'Deadlock found' });
    expect(conflictFieldFrom(err)).toBeUndefined();
  });

  it('returns undefined when the error is not a QueryFailedError', () => {
    expect(conflictFieldFrom(new Error('boom'))).toBeUndefined();
    expect(conflictFieldFrom(null)).toBeUndefined();
    expect(conflictFieldFrom(undefined)).toBeUndefined();
  });
});
