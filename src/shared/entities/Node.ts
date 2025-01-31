import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { GraphEntity } from './Graph';
import { NodeMetaName } from './NodeMeta';

@Entity()
export class NodeEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ManyToOne(() => GraphEntity)
  @JoinColumn({ name: 'graphId' })
  graph!: GraphEntity;

  @Column('uuid')
  graphId!: string;

  @Column({
    type: 'enum',
    enum: NodeMetaName,
    default: NodeMetaName.DEFAULT,
  })
  type!: NodeMetaName;

  @Column('varchar')
  name!: string;

  @Column({
    type: 'varchar',
    nullable: true,
  })
  description!: string;

  @Column('simple-json')
  position!: { x: number; y: number };

  @Column('json')
  data!: Record<string, any>;
}
