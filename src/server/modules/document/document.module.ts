import { Module } from '@nestjs/common';
import { DOCUMENT_REPOSITORY } from './document.di-tokens';
import { DocumentRepository } from './infrastructure/persistence/document.repository';
import { DocumentService } from './application/document.service';
import { DocumentController } from './document.controller';

@Module({
  controllers: [DocumentController],
  providers: [
    DocumentService,
    { provide: DOCUMENT_REPOSITORY, useClass: DocumentRepository },
  ],
})
export class DocumentModule {}
