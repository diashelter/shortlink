import { Column, Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { LinkEntity } from '../links/link.entity';

@Entity({ name: 'link_statistics_days' })
export class LinkStatisticsDayEntity {
  @PrimaryColumn({ type: 'uuid' })
  linkId!: string;

  @PrimaryColumn({ type: 'date' })
  occurredOn!: string;

  @ManyToOne(() => LinkEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'linkId' })
  link!: LinkEntity;

  @Column({ type: 'timestamptz' })
  finalizedAt!: Date;
}
