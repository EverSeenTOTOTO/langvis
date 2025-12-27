import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';

export enum Role {
  SYSTEM = 'system',
  USER = 'user',
  ASSIST = 'assistant',
}

@Entity('messages')
export class MessageEntity {
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

type MessageMeta<T extends Record<string, any>> = {
  loading?: boolean;
  streaming?: boolean;
  error?: boolean;
} & T;

export type Message<T extends Record<string, any> = Record<string, any>> = Omit<
  InstanceType<typeof MessageEntity>,
  'conversation' | 'meta'
> & {
  loading?: boolean;
  meta?: MessageMeta<T> | null;
};
