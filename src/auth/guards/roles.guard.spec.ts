/* eslint-disable @typescript-eslint/no-explicit-any */
import 'reflect-metadata';
import { jest } from '@jest/globals';
import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '../../users/user.entity.js';
import { UsersService } from '../../users/users.service.js';
import { RolesGuard } from './roles.guard.js';

// Minimal ExecutionContext factory. Only switchToHttp().getRequest() and
// getHandler()/getClass() are used by the guard; everything else is omitted.
function makeContext(user: unknown): ExecutionContext {
  return {
    getHandler: () => () => undefined,
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

type MockedUsers = jest.Mocked<Pick<UsersService, 'findActiveById'>>;

function makeGuard(reflectedRoles: UserRole[] | undefined) {
  const reflector = {
    getAllAndOverride: jest.fn(() => reflectedRoles) as any,
  } as unknown as Reflector;
  const users: MockedUsers = { findActiveById: jest.fn() };
  const guard = new RolesGuard(reflector, users as unknown as UsersService);
  return { guard, users };
}

describe('RolesGuard', () => {
  it('lets the request through when no @Roles() marker is present (skips the DB entirely)', async () => {
    const { guard, users } = makeGuard(undefined);
    await expect(
      guard.canActivate(makeContext({ id: 'u', role: UserRole.USER })),
    ).resolves.toBe(true);
    expect(users.findActiveById).not.toHaveBeenCalled();
  });

  it('lets the request through when @Roles() marker is empty', async () => {
    const { guard, users } = makeGuard([]);
    await expect(
      guard.canActivate(makeContext({ id: 'u', role: UserRole.USER })),
    ).resolves.toBe(true);
    expect(users.findActiveById).not.toHaveBeenCalled();
  });

  it('401s when no authenticated user is attached to the request', async () => {
    const { guard } = makeGuard([UserRole.ADMIN]);
    await expect(guard.canActivate(makeContext(undefined))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('401s when the user has been soft-deleted since the JWT was issued', async () => {
    const { guard, users } = makeGuard([UserRole.ADMIN]);
    users.findActiveById.mockResolvedValue(null);
    await expect(
      guard.canActivate(makeContext({ id: 'u', role: UserRole.ADMIN })),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(users.findActiveById).toHaveBeenCalledWith('u');
  });

  it('403s when the JWT claims admin but the DB says the user is a regular user (demoted mid-token)', async () => {
    const { guard, users } = makeGuard([UserRole.ADMIN]);
    users.findActiveById.mockResolvedValue({ id: 'u', role: UserRole.USER });
    await expect(
      guard.canActivate(makeContext({ id: 'u', role: UserRole.ADMIN })),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('allows the request when the DB role matches one of the required roles', async () => {
    const { guard, users } = makeGuard([UserRole.USER, UserRole.ADMIN]);
    users.findActiveById.mockResolvedValue({ id: 'u', role: UserRole.ADMIN });
    await expect(
      guard.canActivate(makeContext({ id: 'u', role: UserRole.ADMIN })),
    ).resolves.toBe(true);
  });

  it('uses the DB role, not the JWT role, for the allow decision', async () => {
    const { guard, users } = makeGuard([UserRole.ADMIN]);
    // JWT says user (would normally be rejected), DB says admin (promoted).
    users.findActiveById.mockResolvedValue({ id: 'u', role: UserRole.ADMIN });
    await expect(
      guard.canActivate(makeContext({ id: 'u', role: UserRole.USER })),
    ).resolves.toBe(true);
  });
});
