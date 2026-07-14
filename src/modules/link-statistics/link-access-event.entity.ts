import { Column, Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { LinkEntity } from '../links/link.entity';

@Entity({ name: 'link_access_events' })
export class LinkAccessEventEntity {
  @PrimaryColumn({ type: 'uuid' })
  id!: string;

  @Column({ type: 'uuid' })
  linkId!: string;

  @ManyToOne(() => LinkEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'linkId' })
  link!: LinkEntity;

  @Column({ type: 'timestamptz' })
  occurredAt!: Date;

  @Column({ type: 'date' })
  occurredOn!: string;

  @Column({ type: 'varchar', length: 7 })
  country!: string;

  @Column({ type: 'varchar', length: 64 })
  visitorPseudonym!: string;
}
