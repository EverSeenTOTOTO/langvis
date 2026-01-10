import type { Conversation } from '@/shared/types/entities';
import {
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { MessageEntity } from './Message';

export { Conversation };

@Entity('conversations')
export class ConversationEntity implements Conversation {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 255 })
  name!: string;

  @Column({ type: 'json', nullable: true })
  config!: Record<string, any> | null;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt!: Date;

  @OneToMany(() => MessageEntity, message => message.conversation)
  messages!: MessageEntity[];
}
