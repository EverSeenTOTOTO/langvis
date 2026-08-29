import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { DocumentEntity } from './Document';

/** HNSW 索引名——DDL 由 VectorIndexInitializer 建，此处同名标记防 synchronize 误删。 */
export const EMBEDDING_HNSW_INDEX_NAME = 'idx_document_chunks_embedding_hnsw';

@Entity('document_chunks')
export class DocumentChunkEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  @Index()
  documentId!: string;

  @Column({ type: 'int' })
  chunkIndex!: number;

  @Column({ type: 'text' })
  content!: string;

  // ORM 表达不了 USING hnsw + opclass，索引本体由 boot 钩子幂等补建。
  @Index(EMBEDDING_HNSW_INDEX_NAME, { synchronize: false })
  @Column('vector', { length: 1024, nullable: true })
  embedding!: number[] | null;

  @Column({ type: 'jsonb', nullable: true })
  metadata!: Record<string, unknown> | null;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt!: Date;

  @ManyToOne(() => DocumentEntity, document => document.chunks, {
    onDelete: 'CASCADE',
  })
  document!: DocumentEntity;
}
