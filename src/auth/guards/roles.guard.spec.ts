/* eslint-disable @typescript-eslint/no-explicit-any */
import 'reflect-metadata';
import { jest } from '@jest/globals';
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '../../users/user.entity.js';
import { RolesGuard } from './roles.guard.js';

// Minimal ExecutionContext factory: enough to stand in for Nest's own instance
// in a unit test. switchToHttp().getRequest() must return an object with
// optional `user`; getHandler()/getClass() are only used as reflector keys.
function makeContext(user: unknown): ExecutionContext {
  return {
    getHandler: () => () => undefined,
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

function makeGuard(reflectedRoles: UserRole[] | undefined): RolesGuard {
  const reflector = {
    getAllAndOverride: jest.fn(() => reflectedRoles) as any,
  } as unknown as Reflector;
  return new RolesGuard(reflector);
}

describe('RolesGuard', () => {
  it('lets the request through when no @Roles() marker is present', () => {
    const guard = makeGuard(undefined);
    expect(guard.canActivate(makeContext({ id: 'u', role: UserRole.USER }))).toBe(true);
  });

  it('lets the request through when @Roles() marker is empty', () => {
    const guard = makeGuard([]);
    expect(guard.canActivate(makeContext({ id: 'u', role: UserRole.USER }))).toBe(true);
  });

  it('403s when no authenticated user is present', () => {
    const guard = makeGuard([UserRole.ADMIN]);
    expect(() => guard.canActivate(makeContext(undefined))).toThrow(ForbiddenException);
  });

  it('403s when the user role is not in the required list', () => {
    const guard = makeGuard([UserRole.ADMIN]);
    expect(() => guard.canActivate(makeContext({ id: 'u', role: UserRole.USER }))).toThrow(
      ForbiddenException,
    );
  });

  it('allows a user whose role matches one of the required', () => {
    const guard = makeGuard([UserRole.USER, UserRole.ADMIN]);
    expect(guard.canActivate(makeContext({ id: 'u', role: UserRole.ADMIN }))).toBe(true);
  });
});
