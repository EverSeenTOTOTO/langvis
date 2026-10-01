import {
  Controller,
  Delete,
  Get,
  HttpException,
  Inject,
  Param,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { DocumentService } from './application/document.service';
import { ListDocumentsRequestDto } from '@/shared/dto/controller';
import { DtoValidationPipe } from '@/server/pipes/dto-validation.pipe';

@Controller('documents')
export class DocumentController {
  constructor(
    @Inject(DocumentService) private readonly documentService: DocumentService,
  ) {}

  @Get()
  async listDocuments(
    @Query(new DtoValidationPipe(ListDocumentsRequestDto))
    dto: ListDocumentsRequestDto,
    @Req() req: Request,
  ) {
    const userId = req.user?.id;
    if (!userId) {
      throw new HttpException({ error: 'Unauthorized' }, 401);
    }
    return this.documentService.listDocuments({
      keyword: dto.keyword,
      category: dto.category,
      startTime: dto.startTime,
      endTime: dto.endTime,
      page: dto.page,
      pageSize: dto.pageSize,
    });
  }

  @Get(':id')
  async getDocumentById(@Param('id') id: string, @Req() req: Request) {
    const userId = req.user?.id;
    if (!userId) {
      throw new HttpException({ error: 'Unauthorized' }, 401);
    }
    const document = await this.documentService.getDocumentById(id);
    if (!document) {
      throw new HttpException({ error: 'Document not found' }, 404);
    }
    return document;
  }

  @Delete(':id')
  async deleteDocument(@Param('id') id: string, @Req() req: Request) {
    const userId = req.user?.id;
    if (!userId) {
      throw new HttpException({ error: 'Unauthorized' }, 401);
    }
    const result = await this.documentService.deleteDocument(id);
    if (!result) {
      throw new HttpException({ error: 'Document not found' }, 404);
    }
    return { success: true };
  }
}
