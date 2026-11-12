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

@Entity({ name: 'refresh_tokens' })
export class RefreshToken {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('IDX_refresh_tokens_userId')
  @Column({ type: 'varchar', length: 36 })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE', onUpdate: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  // sha256 hex digest of the raw refresh token. The raw token is never stored.
  @Index('UQ_refresh_tokens_tokenHash', { unique: true })
  @Column({ type: 'char', length: 64 })
  tokenHash: string;

  @Column({ type: 'datetime', precision: 6 })
  expiresAt: Date;

  @CreateDateColumn({ type: 'datetime', precision: 6 })
  createdAt: Date;

  // null = active; set when the token is rotated, logged out, or compromised.
  @Column({ type: 'datetime', precision: 6, nullable: true })
  revokedAt: Date | null;
}
