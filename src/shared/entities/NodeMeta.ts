import { Column, Entity, PrimaryColumn } from 'typeorm';

export enum NodeType {
  DEFAULT = 'default',
  BUTTON = 'button',
  INPUT = 'input',
  SELECT = 'select',
}

export enum GraphCategory {
  DEFAULT = 'default',
}

@Entity()
export class NodeMetaEntity {
  @PrimaryColumn({
    type: 'enum',
    enum: NodeType,
    default: NodeType.DEFAULT,
  })
  type!: NodeType;

  @Column({
    type: 'enum',
    enum: GraphCategory,
    default: GraphCategory.DEFAULT,
  })
  category!: GraphCategory;
}
