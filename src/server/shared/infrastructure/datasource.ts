import { DataSource } from 'typeorm';
import dotenv from 'dotenv';
import path from 'node:path';
import { buildDataSourceOptions } from './datasource-options';

// CLI 入口（migration:generate/run/revert/show 经 -d 加载此文件）。
// CLI 不走 src/server/index.ts 的 dotenv，此处自载 .env.development。
const envPath =
  process.env.NODE_ENV === 'production'
    ? path.join(process.cwd(), '.env')
    : path.join(process.cwd(), '.env.development');
dotenv.config({ path: envPath, override: true });

export const AppDataSource = new DataSource(buildDataSourceOptions());
