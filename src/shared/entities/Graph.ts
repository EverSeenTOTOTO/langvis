import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum GraphCategory {
  DEFAULT = 'default',
}

@Entity()
export class GraphEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column('varchar')
  name!: string;

  @Column({
    type: 'enum',
    enum: GraphCategory,
    default: GraphCategory.DEFAULT,
  })
  category!: GraphCategory;

  @Column({
    type: 'varchar',
    nullable: true,
  })
  description!: string;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
