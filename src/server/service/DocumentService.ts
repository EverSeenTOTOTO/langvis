import type {
  DocumentDetail,
  DocumentListItem,
  ListDocumentsResponse,
} from '@/shared/dto/controller/document.dto';
import { DocumentCategory, DocumentEntity } from '@/shared/entities/Document';
import { DocumentChunkEntity } from '@/shared/entities/DocumentChunk';
import { inject } from 'tsyringe';
import { Between, LessThanOrEqual, Like, MoreThanOrEqual } from 'typeorm';
import { service } from '../decorator/service';
import { DatabaseService } from './DatabaseService';

@service()
export class DocumentService {
  constructor(@inject(DatabaseService) private readonly db: DatabaseService) {}

  async listDocuments(params: {
    keyword?: string;
    category?: DocumentCategory;
    startTime?: string;
    endTime?: string;
    page?: number;
    pageSize?: number;
  }): Promise<ListDocumentsResponse> {
    const documentRepository = this.db.getRepository(DocumentEntity);

    const page = params.page ?? 1;
    const pageSize = params.pageSize ?? 10;
    const skip = (page - 1) * pageSize;

    const baseConditions: Record<string, any> = {};

    if (params.category) {
      baseConditions.category = params.category;
    }

    if (params.startTime || params.endTime) {
      const startDate = params.startTime
        ? new Date(params.startTime)
        : undefined;
      const endDate = params.endTime ? new Date(params.endTime) : undefined;

      if (startDate && endDate) {
        baseConditions.createdAt = Between(startDate, endDate);
      } else if (startDate) {
        baseConditions.createdAt = MoreThanOrEqual(startDate);
      } else if (endDate) {
        baseConditions.createdAt = LessThanOrEqual(endDate);
      }
    }

    // Build where conditions - use array for OR logic when keyword is provided
    let where: Record<string, any> | Record<string, any>[];
    if (params.keyword) {
      where = [
        { ...baseConditions, title: Like(`%${params.keyword}%`) },
        { ...baseConditions, keywords: Like(`%${params.keyword}%`) },
      ];
    } else {
      where = baseConditions;
    }

    const [items, total] = await documentRepository.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      skip,
      take: pageSize,
      select: [
        'id',
        'title',
        'summary',
        'keywords',
        'category',
        'sourceType',
        'sourceUrl',
        'createdAt',
        'updatedAt',
      ],
    });

    return {
      items: items as DocumentListItem[],
      total,
      page,
      pageSize,
    };
  }

  async getDocumentById(id: string): Promise<DocumentDetail | null> {
    const documentRepository = this.db.getRepository(DocumentEntity);
    const chunkRepository = this.db.getRepository(DocumentChunkEntity);

    const document = await documentRepository.findOneBy({ id });

    if (!document) {
      return null;
    }

    const chunkCount = await chunkRepository.count({
      where: { documentId: id },
    });

    return {
      ...document,
      chunkCount,
    };
  }

  async deleteDocument(id: string): Promise<boolean> {
    const documentRepository = this.db.getRepository(DocumentEntity);

    const result = await documentRepository.delete(id);

    return result.affected ? result.affected > 0 : false;
  }
}
