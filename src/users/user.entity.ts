import {
  BeforeInsert,
  BeforeUpdate,
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum UserRole {
  ADMIN = 'admin',
  USER = 'user',
}

@Entity({ name: 'users' })
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('UQ_users_username', { unique: true })
  @Column({ type: 'varchar', length: 64 })
  username: string;

  @Column({ type: 'varchar', length: 255, select: false })
  passwordHash: string;

  @Column({ type: 'varchar', length: 100 })
  firstName: string;

  @Column({ type: 'varchar', length: 100 })
  lastName: string;

  @Index('UQ_users_emailAddress', { unique: true })
  @Column({ type: 'varchar', length: 255 })
  emailAddress: string;

  @Index('UQ_users_phoneNumber', { unique: true })
  @Column({ type: 'varchar', length: 20, nullable: true })
  phoneNumber: string | null;

  @Column({ type: 'enum', enum: UserRole, default: UserRole.USER })
  role: UserRole;

  @Column({ type: 'datetime', precision: 6, nullable: true })
  lastLoginAt: Date | null;

  @CreateDateColumn({ type: 'datetime', precision: 6 })
  createdAt: Date;

  @UpdateDateColumn({ type: 'datetime', precision: 6 })
  updatedAt: Date;

  @Column({ type: 'datetime', precision: 6, nullable: true })
  emailVerifiedAt: Date | null;

  @DeleteDateColumn({ type: 'datetime', precision: 6, nullable: true })
  deletedAt: Date | null;

  @Column({ type: 'varchar', length: 36, nullable: true })
  lastUpdatedBy: string | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'lastUpdatedBy',
    foreignKeyConstraintName: 'FK_users_lastUpdatedBy',
  })
  lastUpdatedByUser: User | null;

  // Canonicalize identifiers before any entity-based INSERT or UPDATE. This
  // runs on repository.save() with either a new entity or a loaded one. It
  // does NOT run on repository.update(partial) — that goes straight to SQL.
  // Normalizing both here and via a DTO @Transform gives defense in depth.
  @BeforeInsert()
  @BeforeUpdate()
  normalizeIdentifiers(): void {
    if (this.username) this.username = this.username.toLowerCase();
    if (this.emailAddress) this.emailAddress = this.emailAddress.toLowerCase();
  }
}
