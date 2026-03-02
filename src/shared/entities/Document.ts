import {
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { DocumentChunkEntity } from './DocumentChunk';

export type DocumentCategory =
  | 'tech_blog'
  | 'social_media'
  | 'paper'
  | 'documentation'
  | 'news'
  | 'other';

export type DocumentSourceType = 'web' | 'file' | 'text';

export interface DocumentMetadata {
  // tech_blog
  platform?: string;
  techStack?: string[];
  // social_media
  author?: string;
  publishedAt?: string;
  // paper
  authors?: string[];
  venue?: string;
  year?: number;
  // documentation
  library?: string;
  version?: string;
  // news
  source?: string;
  region?: string;
}

@Entity('documents')
export class DocumentEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 500 })
  title!: string;

  @Column({ type: 'text', nullable: true })
  summary!: string | null;

  @Column({ type: 'simple-array' })
  keywords!: string[];

  @Column({ type: 'varchar', length: 50 })
  category!: DocumentCategory;

  @Column({ type: 'varchar', length: 2000, nullable: true })
  sourceUrl!: string | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  sourceType!: DocumentSourceType | null;

  @Column({ type: 'text' })
  rawContent!: string;

  @Column({ type: 'jsonb', nullable: true })
  metadata!: DocumentMetadata | null;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updatedAt!: Date;

  @OneToMany(() => DocumentChunkEntity, chunk => chunk.document)
  chunks!: DocumentChunkEntity[];
}
