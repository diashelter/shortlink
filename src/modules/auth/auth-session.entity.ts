import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { AccountEntity } from './account.entity';
import { SessionRevocationReason } from './auth.types';
import { SessionRefreshTokenEntity } from './session-refresh-token.entity';

@Entity({ name: 'auth_sessions' })
@Index('IDX_auth_sessions_user_id', ['userId'])
@Index('IDX_auth_sessions_user_active', ['userId'], {
  where: '"revokedAt" IS NULL',
})
export class AuthSessionEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  userId!: string;

  @ManyToOne(() => AccountEntity, (account) => account.sessions, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'userId' })
  user!: AccountEntity;

  @Column({ type: 'varchar', length: 128 })
  refreshTokenHash!: string;

  @Column({ type: 'varchar', length: 128 })
  csrfTokenHash!: string;

  @Column({ type: 'timestamptz' })
  expiresAt!: Date;

  @Column({ type: 'timestamptz', nullable: true })
  revokedAt!: Date | null;

  @Column({ type: 'varchar', length: 32, nullable: true })
  revocationReason!: SessionRevocationReason | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @Column({ type: 'timestamptz' })
  lastRotatedAt!: Date;

  @OneToMany(
    () => SessionRefreshTokenEntity,
    (refreshToken) => refreshToken.session,
  )
  refreshTokens!: SessionRefreshTokenEntity[];
}
