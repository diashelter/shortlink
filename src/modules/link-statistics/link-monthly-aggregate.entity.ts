import { Column, Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { LinkEntity } from '../links/link.entity';

@Entity({ name: 'link_monthly_aggregates' })
export class LinkMonthlyAggregateEntity {
  @PrimaryColumn({ type: 'uuid' })
  linkId!: string;

  @PrimaryColumn({ type: 'varchar', length: 7 })
  occurredMonth!: string;

  @ManyToOne(() => LinkEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'linkId' })
  link!: LinkEntity;

  @Column({ type: 'int' })
  accessCount!: number;

  @Column({ type: 'int' })
  dailyUniqueVisitorCount!: number;
}
