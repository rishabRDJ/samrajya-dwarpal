import 'reflect-metadata';
import { jest } from '@jest/globals';
import type { PinoLogger } from 'nestjs-pino';
import { ScopedLogger } from './scoped-logger.js';

// A minimal PinoLogger surface — ScopedLogger only uses info/warn/debug/error.
function makePinoMock(): jest.Mocked<Pick<PinoLogger, 'info' | 'warn' | 'debug' | 'error'>> {
  return {
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
  };
}

describe('ScopedLogger', () => {
  it('writes context as ClassName.method and keeps event + data merged', () => {
    const pino = makePinoMock();
    const logger = new ScopedLogger(pino as unknown as PinoLogger).forClass('AuthService');

    logger.in('login').info('auth.login.succeeded', { userId: 'u1' });

    expect(pino.info).toHaveBeenCalledWith({
      context: 'AuthService.login',
      event: 'auth.login.succeeded',
      userId: 'u1',
    });
  });

  it('data is optional', () => {
    const pino = makePinoMock();
    const logger = new ScopedLogger(pino as unknown as PinoLogger).forClass('TokenService');

    logger.in('revoke').info('auth.logout');

    expect(pino.info).toHaveBeenCalledWith({
      context: 'TokenService.revoke',
      event: 'auth.logout',
    });
  });

  it('warn, debug and info all route to the right pino level', () => {
    const pino = makePinoMock();
    const logger = new ScopedLogger(pino as unknown as PinoLogger).forClass('X');

    logger.in('m').warn('e1');
    logger.in('m').debug('e2', { extra: 1 });
    logger.in('m').info('e3');

    expect(pino.warn).toHaveBeenCalledTimes(1);
    expect(pino.debug).toHaveBeenCalledTimes(1);
    expect(pino.info).toHaveBeenCalledTimes(1);
    expect(pino.debug).toHaveBeenCalledWith({ context: 'X.m', event: 'e2', extra: 1 });
  });

  it('error passes the Error object through as err (so pino serializes the stack)', () => {
    const pino = makePinoMock();
    const logger = new ScopedLogger(pino as unknown as PinoLogger).forClass('Y');
    const boom = new Error('boom');

    logger.in('go').error('y.failed', boom, { userId: 'u1' });

    expect(pino.error).toHaveBeenCalledWith({
      context: 'Y.go',
      event: 'y.failed',
      err: boom,
      userId: 'u1',
    });
  });

  it('two ScopedLogger instances keep independent class names (TRANSIENT scope invariant)', () => {
    // This is what TRANSIENT scope buys us at the DI level: AdminUsersService
    // calling forClass('AdminUsersService') cannot overwrite AuthService's
    // 'AuthService' label because each has its OWN ScopedLogger instance.
    const pinoA = makePinoMock();
    const pinoB = makePinoMock();
    const a = new ScopedLogger(pinoA as unknown as PinoLogger).forClass('AuthService');
    const b = new ScopedLogger(pinoB as unknown as PinoLogger).forClass('AdminUsersService');

    a.in('login').info('x');
    b.in('setRole').info('y');

    expect(pinoA.info).toHaveBeenCalledWith(
      expect.objectContaining({ context: 'AuthService.login' }),
    );
    expect(pinoB.info).toHaveBeenCalledWith(
      expect.objectContaining({ context: 'AdminUsersService.setRole' }),
    );
  });

  it('forClass returns this so it can be chained from a constructor', () => {
    const pino = makePinoMock();
    const instance = new ScopedLogger(pino as unknown as PinoLogger);
    const returned = instance.forClass('Thing');
    expect(returned).toBe(instance);
  });

  it('defaults context to unknown.method when forClass has not been called', () => {
    const pino = makePinoMock();
    new ScopedLogger(pino as unknown as PinoLogger).in('something').info('ev');
    // Default of 'unknown' documents a bug visibly rather than crashing.
    expect(pino.info).toHaveBeenCalledWith(
      expect.objectContaining({ context: 'unknown.something' }),
    );
  });
});
