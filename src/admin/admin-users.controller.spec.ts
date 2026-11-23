/* eslint-disable @typescript-eslint/no-explicit-any */
import 'reflect-metadata';
import { jest } from '@jest/globals';
import type { AuthenticatedUser } from '../auth/jwt.strategy.js';
import { UserRole } from '../users/user.entity.js';
import { AdminUsersController } from './admin-users.controller.js';
import type { AdminUsersService } from './admin-users.service.js';
import { UserListStatus } from './dto/list-admin-users-query.dto.js';

// Thin-controller tests: verify the HTTP layer forwards actor + target ids
// and return shapes to the service. Business rules live in the service
// spec; here we only prove the wiring.

function makeUserRow(overrides: Partial<any> = {}) {
  return {
    id: 'u1',
    username: 'rishab',
    emailAddress: 'rishab@example.com',
    firstName: 'Rishab',
    lastName: 'Jaiswal',
    phoneNumber: null,
    role: UserRole.USER,
    lastLoginAt: null,
    emailVerifiedAt: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

describe('AdminUsersController', () => {
  const admin: AuthenticatedUser = { id: 'admin-1', role: UserRole.ADMIN };
  let service: jest.Mocked<Pick<AdminUsersService, 'list' | 'setRole' | 'softDelete' | 'restore'>>;
  let controller: AdminUsersController;

  beforeEach(() => {
    service = {
      list: jest.fn(),
      setRole: jest.fn(),
      softDelete: jest.fn(),
      restore: jest.fn(),
    };
    controller = new AdminUsersController(service as unknown as AdminUsersService);
  });

  it('GET /admin/users forwards the query DTO to the service', async () => {
    service.list.mockResolvedValue({ data: [], total: 0, page: 1, limit: 20 });
    const q: any = { page: 1, limit: 20, status: UserListStatus.ACTIVE };
    const out = await controller.list(q);
    expect(service.list).toHaveBeenCalledWith(q);
    expect(out.total).toBe(0);
  });

  it('PATCH /admin/users/:id/role forwards actor + target + role, maps to UserResponseDto', async () => {
    service.setRole.mockResolvedValue(makeUserRow({ role: UserRole.ADMIN }) as any);
    const out = await controller.setRole(admin, 'target-id', { role: UserRole.ADMIN });
    expect(service.setRole).toHaveBeenCalledWith('admin-1', 'target-id', UserRole.ADMIN);
    expect(out.role).toBe(UserRole.ADMIN);
    expect(out).not.toHaveProperty('passwordHash');
  });

  it('DELETE /admin/users/:id forwards actor + target and returns no body', async () => {
    service.softDelete.mockResolvedValue(undefined);
    const out = await controller.softDelete(admin, 'target-id');
    expect(service.softDelete).toHaveBeenCalledWith('admin-1', 'target-id');
    expect(out).toBeUndefined();
  });

  it('PATCH /admin/users/:id/restore forwards actor + target, maps to UserResponseDto', async () => {
    service.restore.mockResolvedValue(makeUserRow() as any);
    const out = await controller.restore(admin, 'target-id');
    expect(service.restore).toHaveBeenCalledWith('admin-1', 'target-id');
    expect(out.id).toBe('u1');
  });
});
