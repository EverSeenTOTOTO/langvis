import { DataSource } from 'typeorm';
import { entities, migrations } from '@hedystia/better-auth-typeorm';

const pg = new DataSource({
  type: 'postgres',
  host: import.meta.env.VITE_PG_HOST,
  port: import.meta.env.VITE_PG_PORT,
  username: import.meta.env.VITE_PG_USERNAME,
  password: import.meta.env.VITE_PG_PASSWORD,
  database: import.meta.env.VITE_PG_DATABASE,
  synchronize: true,
  logging: false,
  entities: [...entities],
  migrations: [...migrations],
  migrationsRun: true,
});

export default pg;
