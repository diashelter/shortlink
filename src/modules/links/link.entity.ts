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
import { AccountEntity } from '../auth/account.entity';
import { LinkStatus } from './link-status.enum';

@Entity({ name: 'links' })
@Index('IDX_links_user_created_at_id', ['userId', 'createdAt', 'id'])
@Index('IDX_links_user_destination', ['userId', 'destinationUrl'], {
  unique: true,
})
@Index('IDX_links_user_active', ['userId'], {
  where: `"status" = 'ACTIVE'`,
})
export class LinkEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  userId!: string;

  @ManyToOne(() => AccountEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user!: AccountEntity;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 6 })
  shortCode!: string;

  @Column({ type: 'varchar', length: 2048 })
  destinationUrl!: string;

  @Column({ type: 'varchar', length: 16, default: LinkStatus.ACTIVE })
  status!: LinkStatus;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
