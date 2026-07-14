import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
} from 'typeorm';
import { LinkEntity } from '../links/link.entity';

@Entity({ name: 'link_daily_aggregates' })
export class LinkDailyAggregateEntity {
  @PrimaryColumn({ type: 'uuid' })
  linkId!: string;

  @PrimaryColumn({ type: 'date' })
  occurredOn!: string;

  @PrimaryColumn({ type: 'varchar', length: 7 })
  country!: string;

  @ManyToOne(() => LinkEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'linkId' })
  link!: LinkEntity;

  @Column({ type: 'int' })
  accessCount!: number;

  @Column({ type: 'int' })
  uniqueVisitorCount!: number;
}
