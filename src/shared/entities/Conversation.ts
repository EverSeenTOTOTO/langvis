import type { Conversation } from '@/shared/types/entities';
import {
  Column,
  CreateDateColumn,
  Entity,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { ConversationGroupEntity } from './ConversationGroup';
import { MessageEntity } from './Message';
import { UserEntity } from './User';

export { Conversation };

@Entity('conversations')
export class ConversationEntity implements Conversation {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 255 })
  name!: string;

  @Column({ type: 'json', nullable: true })
  config!: Record<string, any> | null;

  @Column({ type: 'uuid' })
  groupId!: string;

  @Column({ type: 'int', default: 0 })
  order!: number;

  @Column({ type: 'uuid' })
  userId!: string;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt!: Date;

  @ManyToOne(() => ConversationGroupEntity, group => group.conversations)
  group!: ConversationGroupEntity;

  @ManyToOne(() => UserEntity)
  user!: typeof UserEntity;

  @OneToMany(() => MessageEntity, message => message.conversation)
  messages!: MessageEntity[];
}
