import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { AccountEntity } from './account.entity';
import { AuthAuditEventType, AuthAuditMetadata } from './auth.types';

@Entity({ name: 'auth_audit_events' })
@Index('IDX_auth_audit_events_user_id', ['userId'])
export class AuthAuditEventEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', nullable: true })
  userId!: string | null;

  @ManyToOne(() => AccountEntity, (account) => account.auditEvents, {
    onDelete: 'SET NULL',
    nullable: true,
  })
  @JoinColumn({ name: 'userId' })
  user!: AccountEntity | null;

  @Column({ type: 'varchar', length: 32 })
  type!: AuthAuditEventType;

  @Column({ type: 'uuid', nullable: true })
  sessionId!: string | null;

  @Column({ type: 'varchar', length: 128, nullable: true })
  ipHash!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @Column({ type: 'jsonb', nullable: true })
  metadata!: AuthAuditMetadata | null;
}
