import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  OneToMany,
} from 'typeorm';
import { MessageEntity } from './Message';

@Entity('conversations')
export class ConversationEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 255 })
  name!: string;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt!: Date;

  @OneToMany(() => MessageEntity, message => message.conversation)
  messages!: MessageEntity[];
}

export type Conversation = Omit<
  InstanceType<typeof ConversationEntity>,
  'messages'
> & {
  messages?: MessageEntity[];
};
