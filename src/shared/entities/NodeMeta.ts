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
