import { EdgeEntity } from '@/shared/entities/Edge';
import { GraphEntity } from '@/shared/entities/Graph';
import { NodeEntity } from '@/shared/entities/Node';
import { NodeMetaEntity } from '@/shared/entities/NodeMeta';
import { DataSource } from 'typeorm';

export const pgInjectToken = Symbol('pg');

const pg = new DataSource({
  type: 'postgres',
  host: import.meta.env.VITE_PG_HOST,
  port: import.meta.env.VITE_PG_PORT,
  username: import.meta.env.VITE_PG_USERNAME,
  password: import.meta.env.VITE_PG_PASSWORD,
  database: import.meta.env.VITE_PG_DATABASE,
  synchronize: true,
  logging: false,
  entities: [GraphEntity, NodeMetaEntity, NodeEntity, EdgeEntity],
});

export default pg;
