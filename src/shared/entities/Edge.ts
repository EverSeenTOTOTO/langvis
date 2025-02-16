import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { GraphEntity } from './Graph';

export enum EdgeMetaName {
  BEZIER = 'bezier',
  SMOOTH_STEP = 'smooth_step',
  STRAIGHT = 'straight',
}

@Entity()
export class EdgeEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ManyToOne(() => GraphEntity)
  @JoinColumn({ name: 'graphId' })
  graph!: GraphEntity;

  @Column('uuid')
  graphId!: string;

  @Column({
    type: 'enum',
    enum: EdgeMetaName,
    default: EdgeMetaName.BEZIER,
  })
  type!: EdgeMetaName;

  @Column({
    type: 'varchar',
  })
  source!: string;

  @Column({
    type: 'varchar',
  })
  target!: string;

  @Column('json')
  data!: Record<string, any>;
}
