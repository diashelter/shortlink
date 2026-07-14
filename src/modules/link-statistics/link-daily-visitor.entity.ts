import { Column, Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { LinkEntity } from '../links/link.entity';

@Entity({ name: 'link_daily_visitors' })
export class LinkDailyVisitorEntity {
  @PrimaryColumn({ type: 'uuid' })
  linkId!: string;

  @PrimaryColumn({ type: 'date' })
  occurredOn!: string;

  @PrimaryColumn({ type: 'varchar', length: 64 })
  visitorPseudonym!: string;

  @ManyToOne(() => LinkEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'linkId' })
  link!: LinkEntity;

  @Column({ type: 'varchar', length: 7 })
  country!: string;
}
