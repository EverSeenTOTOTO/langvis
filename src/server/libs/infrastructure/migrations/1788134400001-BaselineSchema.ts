import { MigrationInterface, QueryRunner } from 'typeorm';

// app 表基线——auth 4 表由 submodule migration 先建；本迁移补 8 张 app 表 + FK/索引。
// uuid-ossp/vector 幂等兜底（driver.connect 亦装）；HNSW 由 VectorIndexInitializer 补建。
export class BaselineSchema1788134400001 implements MigrationInterface {
  name = 'BaselineSchema1788134400001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "vector"`);
    await queryRunner.query(
      `CREATE TABLE "agent_runs" ("id" character varying(16) NOT NULL, "status" character varying(32) NOT NULL, "events" jsonb, "config" jsonb, "startedAt" TIMESTAMP NOT NULL DEFAULT now(), "completedAt" TIMESTAMP, "version" integer NOT NULL, CONSTRAINT "PK_442f7e0ec4ae860cf17edc57825" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_458e96b4b2cdead051497dcdcc" ON "agent_runs" ("status") `,
    );
    await queryRunner.query(
      `CREATE TABLE "conversation_groups" ("id" character varying(16) NOT NULL, "name" character varying(255) NOT NULL, "order" integer NOT NULL DEFAULT '0', "userId" character varying NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_3b744f3be8a84bf8107f9b09720" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."messages_role_enum" AS ENUM('system', 'user', 'assistant')`,
    );
    await queryRunner.query(
      `CREATE TABLE "messages" ("id" character varying(16) NOT NULL, "role" "public"."messages_role_enum" NOT NULL, "content" text NOT NULL, "attachments" json, "parentId" character varying(16), "agentRunId" character varying(16), "meta" jsonb, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "conversationId" character varying(16) NOT NULL, CONSTRAINT "PK_18325f38ae6de43878487eff986" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_267796c3d1264338a816db0897" ON "messages" ("agentRunId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_messages_conversation_created" ON "messages" ("conversationId", "createdAt") `,
    );
    await queryRunner.query(
      `CREATE TABLE "conversations" ("id" character varying(16) NOT NULL, "name" character varying(255) NOT NULL, "config" json, "groupId" character varying(16) NOT NULL, "order" integer NOT NULL DEFAULT '0', "userId" character varying NOT NULL, "workspacePath" character varying(1024), "createdAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_ee34f4f7ced4ec8681f26bf04ef" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_conversations_user_workspace" ON "conversations" ("userId", "workspacePath") `,
    );
    await queryRunner.query(
      `CREATE TABLE "documents" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "title" character varying(500) NOT NULL, "summary" text, "keywords" text NOT NULL, "category" character varying(50) NOT NULL, "sourceUrl" character varying(2000), "sourceType" character varying(20), "rawContent" text NOT NULL, "metadata" jsonb, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_ac51aa5181ee2036f5ca482857c" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "document_chunks" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "documentId" uuid NOT NULL, "chunkIndex" integer NOT NULL, "content" text NOT NULL, "embedding" vector(1024), "metadata" jsonb, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_7f9060084e9b872dbb567193978" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_eaf9afaf30fb7e2ac25989db51" ON "document_chunks" ("documentId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "archived_emails" ("id" character varying(50) NOT NULL, "messageId" character varying(500) NOT NULL, "from" character varying(255) NOT NULL, "fromName" character varying(255), "to" character varying(255) NOT NULL, "subject" character varying(1000) NOT NULL, "sentAt" TIMESTAMP NOT NULL, "receivedAt" TIMESTAMP NOT NULL, "createdAt" TIMESTAMP NOT NULL, "content" text NOT NULL, "attachmentCount" integer NOT NULL DEFAULT '0', "attachmentNames" text, "metadata" jsonb, "status" character varying(20) NOT NULL DEFAULT 'unarchived', "archivedAt" TIMESTAMP, CONSTRAINT "PK_f1de4dc2553048613d57baf5a2a" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ee8cbdef2dcb85731ed1b15a8c" ON "archived_emails" ("messageId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_c38b58093587c1c8880ac85ba7" ON "archived_emails" ("from") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_d62a8c744cd1d0f4ed9315f94f" ON "archived_emails" ("sentAt") `,
    );
    await queryRunner.query(
      `CREATE TABLE "settings" ("userId" character varying NOT NULL, "themeMode" character varying(16) NOT NULL DEFAULT 'dark', "locale" character varying(16) NOT NULL DEFAULT 'en_US', CONSTRAINT "PK_9175e059b0a720536f7726a88c7" PRIMARY KEY ("userId"))`,
    );
    await queryRunner.query(
      `ALTER TABLE "conversation_groups" ADD CONSTRAINT "FK_21b78c6fc46c04549144edea213" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "messages" ADD CONSTRAINT "FK_e5663ce0c730b2de83445e2fd19" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "conversations" ADD CONSTRAINT "FK_4ccdbe05cf5c31b430c894c3ba7" FOREIGN KEY ("groupId") REFERENCES "conversation_groups"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "conversations" ADD CONSTRAINT "FK_a9b3b5d51da1c75242055338b59" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "document_chunks" ADD CONSTRAINT "FK_eaf9afaf30fb7e2ac25989db51b" FOREIGN KEY ("documentId") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "settings" ADD CONSTRAINT "FK_9175e059b0a720536f7726a88c7" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "settings" DROP CONSTRAINT "FK_9175e059b0a720536f7726a88c7"`,
    );
    await queryRunner.query(
      `ALTER TABLE "document_chunks" DROP CONSTRAINT "FK_eaf9afaf30fb7e2ac25989db51b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "conversations" DROP CONSTRAINT "FK_a9b3b5d51da1c75242055338b59"`,
    );
    await queryRunner.query(
      `ALTER TABLE "conversations" DROP CONSTRAINT "FK_4ccdbe05cf5c31b430c894c3ba7"`,
    );
    await queryRunner.query(
      `ALTER TABLE "messages" DROP CONSTRAINT "FK_e5663ce0c730b2de83445e2fd19"`,
    );
    await queryRunner.query(
      `ALTER TABLE "conversation_groups" DROP CONSTRAINT "FK_21b78c6fc46c04549144edea213"`,
    );
    await queryRunner.query(`DROP TABLE "settings"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_d62a8c744cd1d0f4ed9315f94f"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_c38b58093587c1c8880ac85ba7"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ee8cbdef2dcb85731ed1b15a8c"`,
    );
    await queryRunner.query(`DROP TABLE "archived_emails"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_eaf9afaf30fb7e2ac25989db51b"`,
    );
    await queryRunner.query(`DROP TABLE "document_chunks"`);
    await queryRunner.query(`DROP TABLE "documents"`);
    await queryRunner.query(
      `DROP INDEX "public"."idx_conversations_user_workspace"`,
    );
    await queryRunner.query(`DROP TABLE "conversations"`);
    await queryRunner.query(
      `DROP INDEX "public"."idx_messages_conversation_created"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_267796c3d1264338a816db0897"`,
    );
    await queryRunner.query(`DROP TABLE "messages"`);
    await queryRunner.query(`DROP TYPE "public"."messages_role_enum"`);
    await queryRunner.query(`DROP TABLE "conversation_groups"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_458e96b4b2cdead051497dcdcc"`,
    );
    await queryRunner.query(`DROP TABLE "agent_runs"`);
  }
}
