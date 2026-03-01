import type { ConversationGroup } from '@/shared/types/entities';
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
import { ConversationEntity } from './Conversation';
import { UserEntity } from './User';

export { ConversationGroup };

@Entity('conversation_groups')
export class ConversationGroupEntity implements ConversationGroup {
  @PrimaryColumn('varchar', { length: 16 })
  id!: string;

  @BeforeInsert()
  generateId(): void {
    if (!this.id) {
      this.id = generateId('convgrp');
    }
  }

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
