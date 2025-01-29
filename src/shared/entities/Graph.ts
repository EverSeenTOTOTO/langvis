import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity()
export class GraphEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column()
  name!: string;

  @Column()
  description!: string;

  @Column('timestamp')
  createdAt!: Date;

  @Column('timestamp')
  updatedAt!: Date;
}
