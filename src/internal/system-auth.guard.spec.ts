/* eslint-disable @typescript-eslint/no-explicit-any */
import 'reflect-metadata';
import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'node:crypto';
import { SystemAuthGuard } from './system-auth.guard.js';

const KEY = randomBytes(32).toString('hex');

function makeGuard(expected: string = KEY): SystemAuthGuard {
  const config = {
    getOrThrow: () => expected,
  } as unknown as ConfigService;
  return new SystemAuthGuard(config);
}

function ctxWithHeader(value: unknown) {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ headers: { 'x-system-key': value } }),
    }),
  } as any;
}

describe('SystemAuthGuard', () => {
  it('allows a request with the correct key', () => {
    expect(makeGuard().canActivate(ctxWithHeader(KEY))).toBe(true);
  });

  it('rejects a missing key header', () => {
    expect(() => makeGuard().canActivate(ctxWithHeader(undefined))).toThrow(
      UnauthorizedException,
    );
  });

  it('rejects a non-hex key without crashing', () => {
    expect(() => makeGuard().canActivate(ctxWithHeader('not-hex-value'))).toThrow(
      UnauthorizedException,
    );
  });

  it('rejects a key of the wrong length before timingSafeEqual runs', () => {
    // 62 hex chars = 31 bytes — a short guess must NOT throw a size-mismatch
    // error from crypto.timingSafeEqual; it must return a clean 401.
    const short = 'ab'.repeat(31);
    expect(() => makeGuard().canActivate(ctxWithHeader(short))).toThrow(
      UnauthorizedException,
    );
  });

  it('rejects a well-formed but different key', () => {
    const different = randomBytes(32).toString('hex');
    expect(() => makeGuard().canActivate(ctxWithHeader(different))).toThrow(
      UnauthorizedException,
    );
  });

  it('rejects when the header arrives as a string array', () => {
    // Express sometimes exposes repeated headers as string[]; we only accept
    // a single-string value.
    expect(() => makeGuard().canActivate(ctxWithHeader([KEY]))).toThrow(
      UnauthorizedException,
    );
  });
});
