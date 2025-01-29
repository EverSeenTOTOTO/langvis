import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { GraphEntity } from './Graph';
import { NodeType } from './NodeMeta';

@Entity()
export class NodeEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @ManyToOne(() => GraphEntity)
  @JoinColumn({ name: 'graphId' })
  graph!: GraphEntity;

  @Column()
  graphId!: number;

  @Column({
    type: 'enum',
    enum: NodeType,
    default: NodeType.DEFAULT,
  })
  type!: NodeType;

  @Column()
  name!: string;

  @Column({
    nullable: true,
  })
  description!: string;

  @Column('simple-json')
  position!: { x: number; y: number };

  @Column('json')
  data!: Record<string, any>;
}
