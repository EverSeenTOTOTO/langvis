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
  ASSIST = 'assist',
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

  @CreateDateColumn({ type: 'timestamp' })
  createdAt!: Date;

  @Column({ type: 'uuid' })
  conversationId!: string;

  @ManyToOne('ConversationEntity', 'messages')
  @JoinColumn({ name: 'conversationId' })
  conversation: any;
}

export type Message = Omit<
  InstanceType<typeof MessageEntity>,
  'conversation'
> & {
  loading?: boolean;
};

