import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as argon2 from 'argon2';
import { IsNull, Repository } from 'typeorm';
import { User, UserRole } from './user.entity.js';

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
}
