import { Column, Entity, PrimaryColumn } from 'typeorm';
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

export const NodeInitialData: Record<string, any> = {
  [NodeMetaName.DEFAULT]: {},
  [NodeMetaName.BUTTON]: {
    name: 'Button',
    type: 'default',
    slots: [
      {
        name: 'source',
        type: 'source',
        position: 'right',
      },
      {
        name: 'target',
        type: 'target',
        position: 'left',
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
