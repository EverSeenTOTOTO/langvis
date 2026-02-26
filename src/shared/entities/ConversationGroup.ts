import type { ConversationGroup } from '@/shared/types/entities';
import {
  Column,
  CreateDateColumn,
  Entity,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { ConversationEntity } from './Conversation';
import { UserEntity } from './User';

export { ConversationGroup };

@Entity('conversation_groups')
export class ConversationGroupEntity implements ConversationGroup {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 255 })
  name!: string;

  @Column({ type: 'int', default: 0 })
  order!: number;

  @Column({ type: 'uuid' })
  userId!: string;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt!: Date;

  @ManyToOne(() => UserEntity)
  user!: typeof UserEntity;

  @OneToMany(() => ConversationEntity, conversation => conversation.group)
  conversations!: ConversationEntity[];
}
