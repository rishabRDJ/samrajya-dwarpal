import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as argon2 from 'argon2';
import { IsNull, QueryFailedError, Repository } from 'typeorm';
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

// MySQL's duplicate-key error code. TypeORM surfaces the underlying driver
// error on QueryFailedError.driverError.code.
const MYSQL_DUP_ENTRY = 'ER_DUP_ENTRY';
function isDuplicateKey(err: unknown): err is QueryFailedError {
  return (
    err instanceof QueryFailedError &&
    (err as QueryFailedError & { driverError?: { code?: string } }).driverError?.code === MYSQL_DUP_ENTRY
  );
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
  ) {}

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
    const passwordHash = await argon2.hash(input.password);
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
      return await this.users.save(user);
    } catch (err) {
      // Generic message: do not reveal which field clashed. Clients that need
      // that detail should use GET /auth/availability first, which is the
      // explicit (rate-limited) enumeration surface.
      if (isDuplicateKey(err)) {
        throw new ConflictException('username or email address already in use');
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
    const patch: Partial<User> = {};
    if (input.firstName !== undefined) patch.firstName = input.firstName;
    if (input.lastName !== undefined) patch.lastName = input.lastName;
    if (input.phoneNumber !== undefined) patch.phoneNumber = input.phoneNumber;

    if (Object.keys(patch).length === 0) {
      throw new BadRequestException(
        'at least one of firstName, lastName, phoneNumber must be provided',
      );
    }
    patch.lastUpdatedBy = userId;

    try {
      await this.users.update({ id: userId, deletedAt: IsNull() }, patch);
    } catch (err) {
      if (isDuplicateKey(err)) {
        throw new ConflictException('phone number already in use');
      }
      throw err;
    }
    return this.getActiveProfile(userId);
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
