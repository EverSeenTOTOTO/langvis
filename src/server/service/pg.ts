import { ConversationEntity } from '@/shared/entities/Conversation';
import { ConversationGroupEntity } from '@/shared/entities/ConversationGroup';
import { DocumentEntity } from '@/shared/entities/Document';
import { DocumentChunkEntity } from '@/shared/entities/DocumentChunk';
import { EmailEntity } from '@/shared/entities/Email';
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
  entities: [
    ...entities,
    ConversationEntity,
    MessageEntity,
    ConversationGroupEntity,
    DocumentEntity,
    DocumentChunkEntity,
    EmailEntity,
  ],
  migrations: [...migrations],
  migrationsRun: true,
});

export default pg;
