import { EmailEntity } from '@/shared/entities/Email';
import type {
  EmailListParams,
  EmailListResponse,
  EmailRepositoryPort,
} from '../../domain/port/email.repository.port';
import { DatabaseService } from '@/server/libs/infrastructure/database.service';
import { inject, singleton } from 'tsyringe';
import {
  Between,
  LessThanOrEqual,
  Like,
  MoreThanOrEqual,
  type FindOptionsWhere,
} from 'typeorm';

@singleton()
export class EmailRepository implements EmailRepositoryPort {
  constructor(@inject(DatabaseService) private readonly db: DatabaseService) {}

  private get repository() {
    return this.db.getRepository(EmailEntity);
  }

  async list(params: EmailListParams): Promise<EmailListResponse> {
    const page = params.page ?? 1;
    const pageSize = params.pageSize ?? 20;
    const skip = (page - 1) * pageSize;

    const where: FindOptionsWhere<EmailEntity> = {};

    if (params.from) {
      where.from = Like(`%${params.from}%`);
    }

    if (params.subject) {
      where.subject = Like(`%${params.subject}%`);
    }

    if (params.startDate || params.endDate) {
      const start = params.startDate ? new Date(params.startDate) : undefined;
      const end = params.endDate ? new Date(params.endDate) : undefined;

      if (start && end) {
        where.sentAt = Between(start, end);
      } else if (start) {
        where.sentAt = MoreThanOrEqual(start);
      } else if (end) {
        where.sentAt = LessThanOrEqual(end);
      }
    }

    if (params.status) {
      where.status = params.status;
    }

    const [items, total] = await this.repository.findAndCount({
      where,
      order: { sentAt: 'DESC' },
      skip,
      take: pageSize,
    });

    return { items, total, page, pageSize };
  }

  async getById(id: string): Promise<EmailEntity | null> {
    return this.repository.findOneBy({ id });
  }

  async getByMessageId(messageId: string): Promise<EmailEntity | null> {
    return this.repository.findOneBy({ messageId });
  }

  async existsByMessageId(messageId: string): Promise<boolean> {
    const count = await this.repository.count({ where: { messageId } });
    return count > 0;
  }

  async save(email: EmailEntity): Promise<EmailEntity> {
    return this.repository.save(email);
  }

  async deleteById(id: string): Promise<boolean> {
    const result = await this.repository.delete(id);
    return (result.affected ?? 0) > 0;
  }

  async updateStatus(
    id: string,
    status: 'unarchived' | 'archived',
  ): Promise<boolean> {
    const email = await this.repository.findOneBy({ id });
    if (!email) return false;

    email.status = status;
    if (status === 'archived') {
      email.archivedAt = new Date();
    }

    await this.repository.save(email);
    return true;
  }
}
