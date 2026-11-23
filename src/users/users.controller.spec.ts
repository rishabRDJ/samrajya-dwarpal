/* eslint-disable @typescript-eslint/no-explicit-any */
import 'reflect-metadata';
import { jest } from '@jest/globals';
import type { AuthenticatedUser } from '../auth/jwt.strategy.js';
import { UserRole } from './user.entity.js';
import { UsersController } from './users.controller.js';
import type { UsersService } from './users.service.js';

// A sample User row the service would hand back. toUserResponse maps this
// through, so the shape must match the User entity (not UserResponseDto).
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

describe('UsersController', () => {
  const authed: AuthenticatedUser = { id: 'u1', role: UserRole.USER };
  let service: jest.Mocked<Pick<UsersService, 'getActiveProfile' | 'updateProfile'>>;
  let controller: UsersController;

  beforeEach(() => {
    service = {
      getActiveProfile: jest.fn(),
      updateProfile: jest.fn(),
    };
    controller = new UsersController(service as unknown as UsersService);
  });

  describe('GET /users/me', () => {
    it('loads the profile via getActiveProfile(user.id) and maps it to the public DTO', async () => {
      const row = makeUserRow();
      service.getActiveProfile.mockResolvedValue(row as any);

      const out = await controller.me(authed);

      expect(service.getActiveProfile).toHaveBeenCalledWith('u1');
      // passwordHash, deletedAt, lastUpdatedBy must not leak.
      expect(out).not.toHaveProperty('passwordHash');
      expect(out).not.toHaveProperty('deletedAt');
      expect(out).not.toHaveProperty('lastUpdatedBy');
      expect(out.id).toBe('u1');
    });
  });

  describe('PATCH /users/me', () => {
    it('forwards only the DTO fields to updateProfile and returns the mapped response', async () => {
      const row = makeUserRow({ firstName: 'Changed' });
      service.updateProfile.mockResolvedValue(row as any);

      const out = await controller.update(authed, {
        firstName: 'Changed',
        // lastName intentionally omitted so we prove undefined is forwarded as undefined
        phoneNumber: '+919876543210',
      } as any);

      expect(service.updateProfile).toHaveBeenCalledWith('u1', {
        firstName: 'Changed',
        lastName: undefined,
        phoneNumber: '+919876543210',
      });
      expect(out.firstName).toBe('Changed');
    });

    it('forwards null phoneNumber verbatim (clear intent) rather than dropping it', async () => {
      service.updateProfile.mockResolvedValue(makeUserRow() as any);

      await controller.update(authed, { phoneNumber: null } as any);

      const call = service.updateProfile.mock.calls[0][1];
      expect(call.phoneNumber).toBeNull();
    });
  });
});
