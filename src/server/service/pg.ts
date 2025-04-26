import { EdgeEntity } from '@/shared/entities/Edge';
import { GraphEntity } from '@/shared/entities/Graph';
import { NodeEntity } from '@/shared/entities/Node';
import { NodeMetaEntity } from '@/shared/entities/NodeMeta';
import { DataSource } from 'typeorm';
import { entities, migrations } from '@hedystia/better-auth-typeorm';

export const pgInjectToken = Symbol('pg');

const pg = new DataSource({
  type: 'postgres',
  host: import.meta.env.PG_HOST,
  port: import.meta.env.PG_PORT,
  username: import.meta.env.PG_USERNAME,
  password: import.meta.env.PG_PASSWORD,
  database: import.meta.env.PG_DATABASE,
  synchronize: true,
  logging: false,
  entities: [GraphEntity, NodeMetaEntity, NodeEntity, EdgeEntity, ...entities],
  migrations: [...migrations],
  migrationsRun: true,
});

if (!pg.isInitialized) {
  await pg.initialize();
}

export default pg;
