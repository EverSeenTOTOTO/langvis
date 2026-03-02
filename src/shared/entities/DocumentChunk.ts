import {
  Column,
  CreateDateColumn,
  Entity,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { DocumentEntity } from './Document';

@Entity('document_chunks')
export class DocumentChunkEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  documentId!: string;

  @Column({ type: 'int' })
  chunkIndex!: number;

  @Column({ type: 'text' })
  content!: string;

  @Column('vector', { length: 1536, nullable: true })
  embedding!: number[] | null;

  @Column({ type: 'jsonb', nullable: true })
  metadata!: Record<string, unknown> | null;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt!: Date;

  @ManyToOne(() => DocumentEntity, document => document.chunks)
  document!: DocumentEntity;
}
