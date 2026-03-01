import type { Conversation } from '@/shared/types/entities';
import {
  BeforeInsert,
  Column,
  CreateDateColumn,
  Entity,
  ManyToOne,
  OneToMany,
  PrimaryColumn,
} from 'typeorm';
import { generateId } from '@/shared/utils';
import { ConversationGroupEntity } from './ConversationGroup';
import { MessageEntity } from './Message';
import { UserEntity } from './User';

export { Conversation };

@Entity('conversations')
export class ConversationEntity implements Conversation {
  @PrimaryColumn('varchar', { length: 16 })
  id!: string;

  @BeforeInsert()
  generateId(): void {
    if (!this.id) {
      this.id = generateId('conv');
    }
  }

  @Column({ type: 'varchar', length: 255 })
  name!: string;

  @Column({ type: 'json', nullable: true })
  config!: Record<string, any> | null;

  @Column({ type: 'varchar', length: 16 })
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
