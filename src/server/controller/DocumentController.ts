import { ListDocumentsRequestDto } from '@/shared/dto/controller';
import type { Request, Response } from 'express';
import { inject } from 'tsyringe';
import { api } from '../decorator/api';
import { controller } from '../decorator/controller';
import { param, query, request, response } from '../decorator/param';
import { DocumentService } from '../service/DocumentService';

@controller('/api/documents')
export default class DocumentController {
  constructor(
    @inject(DocumentService)
    private documentService: DocumentService,
  ) {}

  @api('/')
  async listDocuments(
    @query() dto: ListDocumentsRequestDto,
    @request() req: Request,
    @response() res: Response,
  ) {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const result = await this.documentService.listDocuments({
      keyword: dto.keyword,
      category: dto.category,
      startTime: dto.startTime,
      endTime: dto.endTime,
      page: dto.page,
      pageSize: dto.pageSize,
    });

    return res.json(result);
  }

  @api('/:id')
  async getDocumentById(
    @param('id') id: string,
    @request() req: Request,
    @response() res: Response,
  ) {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const document = await this.documentService.getDocumentById(id);

    if (!document) {
      return res.status(404).json({ error: 'Document not found' });
    }

    return res.json(document);
  }

  @api('/:id', { method: 'delete' })
  async deleteDocument(
    @param('id') id: string,
    @request() req: Request,
    @response() res: Response,
  ) {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const result = await this.documentService.deleteDocument(id);

    if (!result) {
      return res.status(404).json({ error: 'Document not found' });
    }

    return res.json({ success: true });
  }
}
