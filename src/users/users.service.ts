import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as argon2 from 'argon2';
import { EntityManager, IsNull, Repository } from 'typeorm';
import {
  conflictFieldFrom,
  type ConflictField,
} from '../common/errors/duplicate-key.js';
import { ScopedLogger } from '../common/logging/scoped-logger.js';
import { User, UserRole } from './user.entity.js';

// Plain structural input so UsersService does not depend on auth/dto. The
// controller maps RegisterDto → this before calling.
export interface RegisterInput {
  username: string;
  emailAddress: string;
  firstName: string;
  lastName: string;
  password: string;
  phoneNumber?: string;
}

export interface AvailabilityInput {
  username?: string;
  emailAddress?: string;
}

// Patch shape for PATCH /users/me. All fields optional; undefined means "don't
// touch", null on phoneNumber means "clear it". At least one field must be
// defined — the service guards that so controllers can stay trivial.
export interface UpdateProfileInput {
  firstName?: string;
  lastName?: string;
  phoneNumber?: string | null;
}

// Response body for 409 Conflict on register / updateProfile. The
// controller never constructs this itself — the service throws a
// ConflictException with this shape as the response, and Nest serialises
// it as the body. `conflictField` lets clients highlight exactly which
// input to fix.
function duplicateConflict(field: ConflictField): ConflictException {
  return new ConflictException({
    message: `${field} already in use`,
    conflictField: field,
  });
}

// Minimal shape an auth flow needs. Keeping it narrow prevents callers from
// leaking passwordHash further than login needs it.
export interface UserAuthView {
  id: string;
  role: UserRole;
  passwordHash: string;
}

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly users: Repository<User>,
    private readonly logger: ScopedLogger,
  ) {
    this.logger.forClass(UsersService.name);
  }

  // Login identifier is either an email or a username; the '@' heuristic
  // decides which column to query. passwordHash has select: false on the
  // entity, so an explicit addSelect is required.
  async findForAuth(identifier: string): Promise<UserAuthView | null> {
    const column = identifier.includes('@') ? 'emailAddress' : 'username';
    const row = await this.users
      .createQueryBuilder('user')
      .select(['user.id', 'user.role', 'user.passwordHash'])
      .where(`user.${column} = :identifier`, { identifier })
      .andWhere('user.deletedAt IS NULL')
      .getOne();
    if (!row) return null;
    return { id: row.id, role: row.role, passwordHash: row.passwordHash };
  }

  // Returns the full active user or throws 401. Used by self-service /users/me
  // handlers that want the whole profile loaded fresh from the DB so demotion
  // and soft-deletion take effect immediately instead of waiting for the
  // 15-minute access token to expire.
  async getActiveProfile(id: string): Promise<User> {
    const user = await this.users.findOne({
      where: { id, deletedAt: IsNull() },
    });
    if (!user) throw new UnauthorizedException();
    return user;
  }

  // Used by TokenService.rotate() and RolesGuard to confirm the subject still
  // exists and hasn't been soft-deleted since the token was issued.
  async findActiveById(
    id: string,
  ): Promise<{ id: string; role: UserRole } | null> {
    const row = await this.users.findOne({
      where: { id, deletedAt: IsNull() },
      select: { id: true, role: true },
    });
    return row ? { id: row.id, role: row.role } : null;
  }

  // Minimum needed to orchestrate a password change: identity + current hash.
  // Used by AuthService.changePassword — it verifies against the current hash
  // and then re-issues tokens with the role. Keep it narrow so the password
  // hash does not spread to other callers.
  async getPasswordContext(
    userId: string,
  ): Promise<{ id: string; role: UserRole; passwordHash: string } | null> {
    const row = await this.users
      .createQueryBuilder('user')
      .select(['user.id', 'user.role', 'user.passwordHash'])
      .where('user.id = :id', { id: userId })
      .andWhere('user.deletedAt IS NULL')
      .getOne();
    return row
      ? { id: row.id, role: row.role, passwordHash: row.passwordHash }
      : null;
  }

  // Compare-and-set password update. `expectedCurrentHash` AND
  // `deletedAt IS NULL` both become part of the WHERE so EVERY kind of
  // concurrent mutation is detected:
  //   * another /me/password tab swapped the hash → WHERE's hash misses
  //   * an admin soft-deleted the user mid-argon2 → WHERE's deletedAt misses
  //   * a future admin password-reset ran → WHERE's hash misses
  // In every case result.affected === 0 → return false → the caller turns
  // it into a 409 and refuses to issue fresh tokens for a row that no
  // longer matches what we verified.
  async updatePasswordHash(
    userId: string,
    expectedCurrentHash: string,
    newHash: string,
    manager?: EntityManager,
  ): Promise<boolean> {
    const repo = manager ? manager.getRepository(User) : this.users;
    const result = await repo.update(
      { id: userId, passwordHash: expectedCurrentHash, deletedAt: IsNull() },
      { passwordHash: newHash, lastUpdatedBy: userId },
    );
    return (result.affected ?? 0) === 1;
  }

  // argon2 settings live in one place. Callers should not import argon2 and
  // compute hashes themselves — that silently diverges tuning over time.
  async hashPassword(rawPassword: string): Promise<string> {
    return argon2.hash(rawPassword);
  }

  // argon2.verify is constant-time and handles salt + params that were baked
  // into the stored hash at signup time. Never compare hashes with ===.
  async verifyPassword(
    storedHash: string,
    rawPassword: string,
  ): Promise<boolean> {
    try {
      return await argon2.verify(storedHash, rawPassword);
    } catch {
      // A malformed hash in the DB (shouldn't happen) must not look like a
      // successful login. Treat any parse error as "wrong password".
      return false;
    }
  }

  async markLoggedIn(id: string): Promise<void> {
    await this.users.update({ id }, { lastLoginAt: new Date() });
  }

  async register(input: RegisterInput): Promise<User> {
    const log = this.logger.in('register');
    const passwordHash = await this.hashPassword(input.password);
    const user = this.users.create({
      username: input.username,
      emailAddress: input.emailAddress,
      firstName: input.firstName,
      lastName: input.lastName,
      phoneNumber: input.phoneNumber ?? null,
      passwordHash,
      role: UserRole.USER,
    });
    try {
      const saved = await this.users.save(user);
      log.info('auth.register.succeeded', { userId: saved.id });
      return saved;
    } catch (err) {
      // Field-specific 409: username / emailAddress / phoneNumber each
      // throw their own exception with conflictField set. This reveals
      // which input is taken — accepted because /register is rate-limited
      // to 3/min and /availability already enumerates at 30/min. An
      // unrecognised index MUST bubble as 500: a wrong 409 would be worse
      // than an error.
      const field = conflictFieldFrom(err);
      if (field) {
        log.warn('auth.register.conflict', { conflictField: field });
        throw duplicateConflict(field);
      }
      throw err;
    }
  }

  // Patches a self-service profile. 'at least one field' is enforced here so
  // the controller stays a one-liner. Duplicate phoneNumber → 409 (unique
  // index on phoneNumber in the user entity). Soft-deleted users cannot edit
  // themselves — the UPDATE's WHERE guards that, and the follow-up read via
  // getActiveProfile throws 401 if the row has vanished.
  async updateProfile(userId: string, input: UpdateProfileInput): Promise<User> {
    const log = this.logger.in('updateProfile');
    const patch: Partial<User> = {};
    if (input.firstName !== undefined) patch.firstName = input.firstName;
    if (input.lastName !== undefined) patch.lastName = input.lastName;
    if (input.phoneNumber !== undefined) patch.phoneNumber = input.phoneNumber;

    // Field NAMES only — never values. Captured now so a later refactor
    // that mutates `patch` can't accidentally include them.
    const changedFields = Object.keys(patch);

    if (changedFields.length === 0) {
      log.warn('user.profile.update_failed', { userId, reason: 'no_fields' });
      throw new BadRequestException(
        'at least one of firstName, lastName, phoneNumber must be provided',
      );
    }
    patch.lastUpdatedBy = userId;

    try {
      await this.users.update({ id: userId, deletedAt: IsNull() }, patch);
    } catch (err) {
      const field = conflictFieldFrom(err);
      if (field) {
        // PATCH /users/me only whitelists phoneNumber as a unique field,
        // so field is always 'phoneNumber' here today; `conflictField` is
        // still emitted structurally in case the DTO ever opens up more.
        log.warn('user.profile.update_failed', {
          userId,
          reason: 'duplicate',
          conflictField: field,
        });
        throw duplicateConflict(field);
      }
      throw err;
    }
    const fresh = await this.getActiveProfile(userId);
    log.info('user.profile.updated', { userId, fields: changedFields });
    return fresh;
  }

  // Soft-deleted identifiers stay reserved (spec), so withDeleted: true.
  async isAvailable(input: AvailabilityInput): Promise<boolean> {
    const where = input.username
      ? { username: input.username }
      : { emailAddress: input.emailAddress };
    const existing = await this.users.findOne({ where, withDeleted: true });
    return existing === null;
  }
}
