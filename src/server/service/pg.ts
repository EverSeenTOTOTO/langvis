import { ConversationEntity } from '@/shared/entities/Conversation';
import { MessageEntity } from '@/shared/entities/Message';
import { entities, migrations } from '@hedystia/better-auth-typeorm';
import { DataSource } from 'typeorm';

const pg = new DataSource({
  type: 'postgres',
  host: import.meta.env.VITE_PG_HOST,
  port: import.meta.env.VITE_PG_PORT,
  username: import.meta.env.VITE_PG_USERNAME,
  password: import.meta.env.VITE_PG_PASSWORD,
  database: import.meta.env.VITE_PG_DATABASE,
  synchronize: true,
  logging: false,
  entities: [ConversationEntity, MessageEntity, ...entities],
  migrations: [...migrations],
  migrationsRun: true,
});

export default pg;
