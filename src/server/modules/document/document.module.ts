import { container, Lifecycle } from 'tsyringe';
import { DOCUMENT_REPOSITORY } from './document.di-tokens';
import { DocumentRepository } from './infrastructure/persistence/document.repository';

container.register(DOCUMENT_REPOSITORY, DocumentRepository, {
  lifecycle: Lifecycle.Singleton,
});
