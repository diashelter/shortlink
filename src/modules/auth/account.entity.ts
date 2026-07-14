import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { AccountRole } from './account-role.enum';
import { AccountStatus } from './account-status.enum';
import { AuthAuditEventEntity } from './auth-audit-event.entity';
import { AuthSessionEntity } from './auth-session.entity';
import { PasswordResetTokenEntity } from './password-reset-token.entity';

@Entity({ name: 'users' })
export class AccountEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 320 })
  email!: string;

  @Column({ type: 'varchar', length: 16 })
  status!: AccountStatus;

  @Column({ type: 'varchar', length: 16 })
  role!: AccountRole;

  @Column({ type: 'varchar', length: 60 })
  passwordHash!: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;

  @OneToMany(() => AuthSessionEntity, (session) => session.user)
  sessions!: AuthSessionEntity[];

  @OneToMany(() => PasswordResetTokenEntity, (token) => token.user)
  passwordResetTokens!: PasswordResetTokenEntity[];

  @OneToMany(() => AuthAuditEventEntity, (event) => event.user)
  auditEvents!: AuthAuditEventEntity[];
}
