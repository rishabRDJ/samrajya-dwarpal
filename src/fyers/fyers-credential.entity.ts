import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '../users/user.entity.js';

// The environment's one active Fyers access token. The singletonKey column
// is always the literal string 'active'; the UNIQUE index on it is what
// makes the DB refuse a second row. Upsert on (singletonKey) at write time.
//
// connectedByUserId is audit metadata: whichever admin completed the daily
// login. ON DELETE SET NULL because the token belongs to the environment,
// not to the user — deleting the admin must not nuke the live session.
@Entity({ name: 'fyers_credentials' })
export class FyersCredential {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('UQ_fyers_credentials_singletonKey', { unique: true })
  @Column({ type: 'varchar', length: 32, default: 'active' })
  singletonKey: string;

  @Column({ type: 'varchar', length: 36, nullable: true })
  connectedByUserId: string | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'connectedByUserId',
    foreignKeyConstraintName: 'FK_fyers_credentials_connectedByUserId',
  })
  connectedByUser: User | null;

  @Column({ type: 'text' })
  encryptedToken: string;

  @Column({ type: 'varchar', length: 64 })
  iv: string;

  @Column({ type: 'varchar', length: 64 })
  authTag: string;

  @Column({ type: 'int', default: 1 })
  keyVersion: number;

  @Column({ type: 'datetime', precision: 6 })
  expiresAt: Date;

  @CreateDateColumn({ type: 'datetime', precision: 6 })
  createdAt: Date;

  @UpdateDateColumn({ type: 'datetime', precision: 6 })
  updatedAt: Date;
}
