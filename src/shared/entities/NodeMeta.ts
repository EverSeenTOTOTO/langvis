import { Position } from '@xyflow/react';
import { Column, Entity, PrimaryColumn } from 'typeorm';
import { ClientNodeProps } from '../types';
import { GraphCategory } from './Graph';

export enum NodeMetaName {
  DEFAULT = 'default',
  BUTTON = 'button',
  SELECT = 'select',
  IMAGE = 'image',
}

export enum NodeType {
  INTERACTION = 'interaction',
  DISPLAY = 'display',
}

export const NodeInitialData: Record<
  string,
  Partial<ClientNodeProps['data']>
> = {
  [NodeMetaName.DEFAULT]: {},
  [NodeMetaName.BUTTON]: {
    name: 'Button',
    slots: [
      {
        name: 'source',
        type: 'source',
        position: Position.Left,
      },
      {
        name: 'target',
        type: 'target',
        position: Position.Right,
      },
    ],
  },
};

@Entity()
export class NodeMetaEntity {
  @PrimaryColumn({
    type: 'enum',
    enum: NodeMetaName,
    default: NodeMetaName.DEFAULT,
  })
  name!: NodeMetaName;

  @Column({
    type: 'enum',
    enum: NodeType,
    default: NodeType.INTERACTION,
  })
  type!: NodeType;

  @Column({
    type: 'json',
    default: JSON.stringify(Object.values(GraphCategory)),
  })
  supportCategories!: string;

  @Column({
    type: 'text',
    nullable: true,
  })
  description?: string;
}
