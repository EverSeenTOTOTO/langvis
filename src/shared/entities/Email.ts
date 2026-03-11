import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

export interface EmailMetadata {
  [key: string]: unknown;
}

@Entity('archived_emails')
export class EmailEntity {
  @PrimaryColumn({ type: 'varchar', length: 50 })
  id!: string;

  @Column({ type: 'varchar', length: 500 })
  @Index()
  messageId!: string;

  @Column({ type: 'varchar', length: 255 })
  @Index()
  from!: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  fromName!: string | null;

  @Column({ type: 'varchar', length: 255 })
  to!: string;

  @Column({ type: 'varchar', length: 1000 })
  subject!: string;

  @Column({ type: 'timestamp' })
  @Index()
  sentAt!: Date;

  @Column({ type: 'timestamp' })
  receivedAt!: Date;

  @Column({ type: 'timestamp' })
  createdAt!: Date;

  @Column({ type: 'text' })
  content!: string;

  @Column({ type: 'int', default: 0 })
  attachmentCount!: number;

  @Column({ type: 'simple-array', nullable: true })
  attachmentNames!: string[] | null;

  @Column({ type: 'jsonb', nullable: true })
  metadata!: EmailMetadata | null;

  @Column({ type: 'varchar', length: 20, default: 'unarchived' })
  status!: 'unarchived' | 'archived';

  @Column({ type: 'timestamp', nullable: true })
  archivedAt!: Date | null;
}
