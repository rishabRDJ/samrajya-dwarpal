import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { Brackets, DataSource, EntityManager, IsNull, Not, Repository } from 'typeorm';
import { TokenService } from '../auth/token.service.js';
import { User, UserRole } from '../users/user.entity.js';
import {
  ListAdminUsersQueryDto,
  UserListStatus,
} from './dto/list-admin-users-query.dto.js';
import { PaginatedUsersDto } from './dto/paginated-users.dto.js';
import { toUserResponse } from '../users/dto/user-response.dto.js';

// AdminUsersService is the business layer behind /v1/admin/users. Rules
// enforced here, not in the controller:
//   1. noSelfAdministration — an admin cannot change their own role or
//      delete themselves. Blocks accidents + preserves audit trail.
//   2. assertNotLastAdmin — the system must always have at least one active
//      admin. Enforced with a pessimistic SELECT ... FOR UPDATE so two
//      concurrent demotions cannot both pass a count check and leave zero.
//   3. Demote-and-delete revoke all refresh tokens inside the same
//      transaction. A soft-deleted or demoted user must not keep live
//      sessions.
@Injectable()
export class AdminUsersService {
  constructor(
    @InjectRepository(User)
    private readonly users: Repository<User>,
    private readonly tokens: TokenService,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  async list(query: ListAdminUsersQueryDto): Promise<PaginatedUsersDto> {
    const qb = this.users.createQueryBuilder('user').withDeleted();

    if (query.status === UserListStatus.ACTIVE) {
      qb.andWhere('user.deletedAt IS NULL');
    } else if (query.status === UserListStatus.DELETED) {
      qb.andWhere('user.deletedAt IS NOT NULL');
    }
    if (query.role !== undefined) {
      qb.andWhere('user.role = :role', { role: query.role });
    }
    if (query.q) {
      // Prefix match is cheap under the username / emailAddress unique
      // indexes. The DTO already lowercased q, matching the stored form.
      qb.andWhere(
        new Brackets((b) => {
          b.where('user.username LIKE :q', { q: `${query.q}%` }).orWhere(
            'user.emailAddress LIKE :q',
            { q: `${query.q}%` },
          );
        }),
      );
    }

    qb.orderBy('user.createdAt', 'DESC')
      .skip((query.page - 1) * query.limit)
      .take(query.limit);

    const [rows, total] = await qb.getManyAndCount();
    return {
      data: rows.map(toUserResponse),
      total,
      page: query.page,
      limit: query.limit,
    };
  }

  async setRole(
    actingAdminId: string,
    targetId: string,
    newRole: UserRole,
  ): Promise<User> {
    if (actingAdminId === targetId) {
      throw new ForbiddenException('admins cannot change their own role');
    }

    return this.dataSource.transaction(async (em) => {
      const target = await this.loadForWrite(em, targetId);
      if (target.deletedAt !== null) {
        // Deleted users shouldn't appear in admin lookups for role change.
        // Expose as 404 rather than 410 to avoid leaking the deleted state
        // to callers that only sent a probably-mistyped id.
        throw new NotFoundException('user not found');
      }

      // Idempotent: setting the same role is a no-op success. Clients can
      // retry PATCH without poisoning the state.
      if (target.role === newRole) return target;

      // Demoting an admin? Last-admin check guards the invariant.
      if (target.role === UserRole.ADMIN && newRole !== UserRole.ADMIN) {
        await this.assertNotLastAdmin(em);
      }

      await em.getRepository(User).update(
        { id: targetId },
        { role: newRole, lastUpdatedBy: actingAdminId },
      );

      // Demotion kills all refresh sessions: the user keeps their 15-min
      // access token (the stale JWT) but RolesGuard already blocks admin
      // routes against the fresh DB role. See step 3.
      if (target.role === UserRole.ADMIN && newRole !== UserRole.ADMIN) {
        await this.tokens.revokeAllForUser(targetId, em);
      }

      return this.loadForWrite(em, targetId);
    });
  }

  async softDelete(actingAdminId: string, targetId: string): Promise<void> {
    if (actingAdminId === targetId) {
      throw new ForbiddenException('admins cannot delete themselves');
    }

    await this.dataSource.transaction(async (em) => {
      const target = await this.loadForWrite(em, targetId);
      if (target.deletedAt !== null) {
        // Already soft-deleted: 404 for the same leak reason as above.
        throw new NotFoundException('user not found');
      }

      if (target.role === UserRole.ADMIN) {
        await this.assertNotLastAdmin(em);
      }

      await em.getRepository(User).softDelete({ id: targetId });
      await em.getRepository(User).update(
        { id: targetId },
        { lastUpdatedBy: actingAdminId },
      );
      await this.tokens.revokeAllForUser(targetId, em);
    });
  }

  async restore(actingAdminId: string, targetId: string): Promise<User> {
    if (actingAdminId === targetId) {
      // A deleted admin cannot log in, so reaching here with self === target
      // should be impossible. Block anyway for symmetry and defense in depth.
      throw new ForbiddenException('admins cannot restore themselves');
    }

    return this.dataSource.transaction(async (em) => {
      // withDeleted() so we can see the soft-deleted row.
      const target = await em
        .getRepository(User)
        .createQueryBuilder('user')
        .setLock('pessimistic_write')
        .withDeleted()
        .where('user.id = :id', { id: targetId })
        .getOne();
      if (!target) throw new NotFoundException('user not found');
      if (target.deletedAt === null) {
        throw new ConflictException('user is not deleted');
      }

      await em.getRepository(User).restore({ id: targetId });
      await em.getRepository(User).update(
        { id: targetId },
        { lastUpdatedBy: actingAdminId },
      );
      // Do not re-issue refresh tokens: the user will log in fresh.
      return this.loadForWrite(em, targetId);
    });
  }

  // Locks the single user row FOR UPDATE inside a transaction. Serializes
  // concurrent operations on the same target. Does NOT lock the admin set
  // on its own — that's assertNotLastAdmin's job.
  private async loadForWrite(em: EntityManager, id: string): Promise<User> {
    const row = await em
      .getRepository(User)
      .createQueryBuilder('user')
      .setLock('pessimistic_write')
      .withDeleted()
      .where('user.id = :id', { id })
      .getOne();
    if (!row) throw new NotFoundException('user not found');
    return row;
  }

  // SELECT every active admin row FOR UPDATE. Two concurrent transactions
  // that both reach this line block each other on at least one row — one
  // commits first, the second re-reads the (now-smaller) admin set and sees
  // count <= 1, then throws. That prevents both from committing a demotion
  // and leaving zero admins.
  private async assertNotLastAdmin(em: EntityManager): Promise<void> {
    const admins = await em
      .getRepository(User)
      .createQueryBuilder('user')
      .setLock('pessimistic_write')
      .select(['user.id'])
      .where('user.role = :role', { role: UserRole.ADMIN })
      .andWhere({ deletedAt: IsNull() })
      .getMany();

    if (admins.length <= 1) {
      throw new ConflictException('cannot remove the last admin');
    }
  }

  // Exposed for tests only: a helper that confirms the invariant without
  // actually running an operation.
  async countActiveAdmins(notTargetId?: string): Promise<number> {
    const where = notTargetId
      ? { role: UserRole.ADMIN, deletedAt: IsNull(), id: Not(notTargetId) }
      : { role: UserRole.ADMIN, deletedAt: IsNull() };
    return this.users.count({ where });
  }
}
