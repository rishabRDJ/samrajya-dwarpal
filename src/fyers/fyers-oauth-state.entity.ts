import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from '../users/user.entity.js';

// One row per Fyers login in progress. Short-lived (10 minutes) and
// append-once: created at /login-url, optionally consumed by /callback.
// The raw state only ever lives in the admin's browser and the redirect URL;
// here we keep the SHA-256 hash so a DB dump cannot replay pending logins.
@Entity({ name: 'fyers_oauth_states' })
export class FyersOauthState {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('UQ_fyers_oauth_states_stateHash', { unique: true })
  @Column({ type: 'char', length: 64 })
  stateHash: string;

  @Column({ type: 'varchar', length: 36 })
  @Index('IDX_fyers_oauth_states_userId')
  userId: string;

  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'userId',
    foreignKeyConstraintName: 'FK_fyers_oauth_states_userId',
  })
  user: User;

  @Column({ type: 'datetime', precision: 6 })
  expiresAt: Date;

  @Column({ type: 'datetime', precision: 6, nullable: true })
  usedAt: Date | null;

  @CreateDateColumn({ type: 'datetime', precision: 6 })
  createdAt: Date;
}
