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

  @Column({ type: 'json', nullable: true })
  config!: Record<string, any> | null;

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
