import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';

import type { Message } from '@/shared/types/entities';
import { Role } from '@/shared/types/entities';

export { Message, Role };

@Entity('messages')
export class MessageEntity implements Message {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({
    type: 'enum',
    enum: Role,
  })
  role!: Role;

  @Column({ type: 'text' })
  content!: string;

  @Column({ type: 'json', nullable: true })
  meta!: Record<string, any> | null;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt!: Date;

  @Column({ type: 'uuid' })
  conversationId!: string;

  @ManyToOne('ConversationEntity', 'messages')
  @JoinColumn({ name: 'conversationId' })
  conversation: any;
}
