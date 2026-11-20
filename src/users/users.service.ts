import { ConflictException, Injectable } from '@nestjs/common';
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

  // Used by TokenService.rotate() to confirm the refresh token's owner still
  // exists and hasn't been soft-deleted since issuance.
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

  // Soft-deleted identifiers stay reserved (spec), so withDeleted: true.
  async isAvailable(input: AvailabilityInput): Promise<boolean> {
    const where = input.username
      ? { username: input.username }
      : { emailAddress: input.emailAddress };
    const existing = await this.users.findOne({ where, withDeleted: true });
    return existing === null;
  }
}
