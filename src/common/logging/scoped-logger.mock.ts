import { jest } from '@jest/globals';
import { ScopedLogger } from './scoped-logger.js';

// Factory for unit tests. Returns a jest-mocked ScopedLogger plus the
// per-level mock functions, so a test can either:
//   * ignore logs by passing `logger.instance` as the provider, OR
//   * assert calls against `logger.info`, `logger.warn`, etc.
//
// The facade shape mirrors ScopedLogger exactly: `in(method)` returns an
// object with `{info, warn, debug, error}`. Here that object is a single
// shared record so every test assertion lands on the same mocks and the
// test can inspect the whole call history at once:
//
//   const { instance, info, warn } = createScopedLoggerMock();
//   // ...
//   expect(instance.in).toHaveBeenCalledWith('login');
//   expect(warn).toHaveBeenCalledWith('auth.login.failed', { reason: '...' });
export interface ScopedLoggerMock {
  instance: ScopedLogger;
  info: jest.Mock;
  warn: jest.Mock;
  debug: jest.Mock;
  error: jest.Mock;
}

export function createScopedLoggerMock(): ScopedLoggerMock {
  const info = jest.fn();
  const warn = jest.fn();
  const debug = jest.fn();
  const error = jest.fn();
  const inReturn = { info, warn, debug, error };
  const instance = {
    forClass: jest.fn(function (this: unknown) {
      return this;
    }),
    in: jest.fn(() => inReturn),
  } as unknown as ScopedLogger;
  return { instance, info, warn, debug, error };
}
