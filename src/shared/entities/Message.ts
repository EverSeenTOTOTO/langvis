import type { Message, MessageAttachment } from '@/shared/types/entities';
import {
  BeforeInsert,
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
} from 'typeorm';
import type { ConversationEntity } from './Conversation';
import { Role } from '@/shared/types/entities';
import { generateId } from '@/shared/utils';

export { Message, Role };

@Entity('messages')
export class MessageEntity implements Message {
  @PrimaryColumn('varchar', { length: 16 })
  id!: string;

  @BeforeInsert()
  generateId(): void {
    if (!this.id) {
      this.id = generateId('msg');
    }
  }

  @Column({
    type: 'enum',
    enum: Role,
  })
  role!: Role;

  @Column({ type: 'text' })
  content!: string;

  @Column({ type: 'json', nullable: true })
  attachments!: MessageAttachment[] | null;

  @Column({ type: 'json', nullable: true })
  meta!: Record<string, any> | null;

  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  createdAt!: Date;

  @Column({ type: 'varchar', length: 16 })
  conversationId!: string;

  @ManyToOne('ConversationEntity', 'messages', {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'conversationId' })
  conversation!: ConversationEntity;
}
