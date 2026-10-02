import type { Message } from '@/shared/types/entities';
import type { MessageAttachment } from '@/shared/types/entities';
import { MessageEntity, Role } from '@/shared/entities/Message';
import type { MessageRepositoryPort } from '../../domain/port/message.repository.port';
import { DatabaseService } from '@/server/infrastructure/database/database.service';
import { Inject } from '@nestjs/common';
import { In } from 'typeorm';

export class MessageRepository implements MessageRepositoryPort {
  constructor(@Inject(DatabaseService) private readonly db: DatabaseService) {}

  async batchCreate(
    conversationId: string,
    messagesData: Array<{
      id?: string;
      role: Role;
      content: string;
      attachments?: MessageAttachment[] | null;
      meta?: Record<string, any> | null;
      createdAt?: Date;
    }>,
  ): Promise<Message[]> {
    const repo = this.db.getRepository(MessageEntity);
    const messages = messagesData.map(data =>
      repo.create({
        ...(data.id && { id: data.id }),
        conversationId,
        role: data.role,
        content: data.content,
        attachments: data.attachments,
        meta: data.meta,
        ...(data.createdAt && { createdAt: data.createdAt }),
      }),
    );
    return await repo.save(messages);
  }

  async findLastAssistantMessage(
    conversationId: string,
  ): Promise<Message | null> {
    const repo = this.db.getRepository(MessageEntity);
    return await repo.findOne({
      where: { conversationId, role: Role.ASSIST },
      order: { createdAt: 'DESC' },
    });
  }

  async findById(messageId: string): Promise<Message | null> {
    const repo = this.db.getRepository(MessageEntity);
    return await repo.findOneBy({ id: messageId });
  }

  async findByConversationId(conversationId: string): Promise<Message[]> {
    const repo = this.db.getRepository(MessageEntity);
    return await repo.find({
      where: { conversationId },
      order: { createdAt: 'ASC' },
    });
  }

  async findByAgentRunIds(runIds: string[]): Promise<Message[]> {
    if (runIds.length === 0) return [];
    const repo = this.db.getRepository(MessageEntity);
    return await repo.find({ where: { agentRunId: In(runIds) } });
  }

  async save(message: Message): Promise<Message> {
    const repo = this.db.getRepository(MessageEntity);
    return await repo.save(message as MessageEntity);
  }

  async batchDeleteInConversation(
    conversationId: string,
    messageIds?: string[],
  ): Promise<void> {
    const repo = this.db.getRepository(MessageEntity);
    if (!messageIds || messageIds.length === 0) {
      await repo.delete({ conversationId });
    } else {
      await repo.delete({ conversationId, id: In(messageIds) });
    }
  }

  async update(
    messageId: string,
    partial: Partial<Message>,
  ): Promise<Message | null> {
    const repo = this.db.getRepository(MessageEntity);
    const message = await repo.findOneBy({ id: messageId });
    if (!message) return null;
    Object.assign(message, partial);
    return await repo.save(message);
  }

  async deleteAfter(
    conversationId: string,
    afterMessageId: string,
  ): Promise<boolean> {
    const repo = this.db.getRepository(MessageEntity);
    const targetMessage = await repo.findOneBy({
      id: afterMessageId,
      conversationId,
    });
    if (!targetMessage) return false;

    await repo
      .createQueryBuilder()
      .delete()
      .from(MessageEntity)
      .where('conversationId = :conversationId', { conversationId })
      .andWhere('createdAt > :createdAt', {
        createdAt: targetMessage.createdAt,
      })
      .execute();
    return true;
  }

  async statsForConversations(
    conversationIds: string[],
  ): Promise<Map<string, { count: number; lastUserMessage: string | null }>> {
    const result = new Map<
      string,
      { count: number; lastUserMessage: string | null }
    >();
    if (conversationIds.length === 0) return result;
    const repo = this.db.getRepository(MessageEntity);

    const countRows = await repo
      .createQueryBuilder('m')
      .select('m.conversationId', 'cid')
      .addSelect('COUNT(*)', 'n')
      .where('m.conversationId IN (:...ids)', { ids: conversationIds })
      .groupBy('m.conversationId')
      .getRawMany();
    for (const row of countRows) {
      result.set(row.cid, {
        count: Number(row.n),
        lastUserMessage: null,
      });
    }

    // DISTINCT ON 取每会话最近一条 user 消息（排除 meta.kind 脚手架）。
    // 列名用引号包 camelCase——TypeORM 默认列名=属性名。
    const latestRows: Array<{ cid: string; content: string | null }> =
      await repo.query(
        `SELECT DISTINCT ON ("conversationId") "conversationId" AS cid, content
         FROM messages
         WHERE "conversationId" = ANY($1) AND role = $2 AND (meta->>'kind') IS NULL
         ORDER BY "conversationId", "createdAt" DESC`,
        [conversationIds, Role.USER],
      );
    for (const row of latestRows) {
      const stat = result.get(row.cid) ?? { count: 0, lastUserMessage: null };
      stat.lastUserMessage = row.content?.slice(0, 60) ?? null;
      result.set(row.cid, stat);
    }
    return result;
  }
}
