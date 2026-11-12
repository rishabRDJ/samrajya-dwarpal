import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
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

  // Never store plaintext. select: false keeps the hash out of normal queries;
  // load it explicitly at login with .addSelect('user.passwordHash').
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
  @Column({ type: 'varchar', length: 20 })
  phoneNumber: string;

  @Column({ type: 'enum', enum: UserRole, default: UserRole.USER })
  role: UserRole;

  @Column({ type: 'datetime', precision: 6, nullable: true })
  lastLoginAt: Date | null;

  @CreateDateColumn({ type: 'datetime', precision: 6 })
  createdAt: Date;

  @UpdateDateColumn({ type: 'datetime', precision: 6 })
  updatedAt: Date;
}
