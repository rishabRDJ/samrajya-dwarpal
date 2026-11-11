import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

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

  @Column({ type: 'timestamp', nullable: true })
  lastLoginAt: Date | null;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updatedAt: Date;
}
