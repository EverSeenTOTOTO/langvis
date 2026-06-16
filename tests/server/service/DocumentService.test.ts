import { DocumentService } from '@/server/modules/document/application/document.service';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DocumentRepositoryPort } from '@/server/modules/document/database/document.repository.port';

const mockRepo = {
  listDocuments: vi.fn(),
  getDocumentById: vi.fn(),
  deleteDocument: vi.fn(),
} as unknown as DocumentRepositoryPort;

describe('DocumentService', () => {
  let documentService: DocumentService;

  beforeEach(() => {
    vi.clearAllMocks();
    documentService = new DocumentService(mockRepo);
  });

  describe('listDocuments', () => {
    it('should list documents with default pagination', async () => {
      const mockDocuments = [
        {
          id: '1',
          title: 'Test Document',
          summary: 'Test summary',
          keywords: ['test'],
          category: 'tech_blog' as const,
          sourceType: 'web' as const,
          sourceUrl: 'https://example.com',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      vi.mocked(mockRepo.listDocuments).mockResolvedValue({
        items: mockDocuments,
        total: 1,
        page: 1,
        pageSize: 10,
      });

      const result = await documentService.listDocuments({});

      expect(result.items).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(result.page).toBe(1);
      expect(result.pageSize).toBe(10);
    });

    it('should delegate listDocuments to repository', async () => {
      vi.mocked(mockRepo.listDocuments).mockResolvedValue({
        items: [],
        total: 0,
        page: 1,
        pageSize: 10,
      });

      const params = { keyword: 'react', category: 'tech_blog' as const };
      await documentService.listDocuments(params);

      expect(mockRepo.listDocuments).toHaveBeenCalledWith(params);
    });
  });

  describe('getDocumentById', () => {
    it('should get document by id', async () => {
      vi.mocked(mockRepo.getDocumentById).mockResolvedValue({
        id: '1',
        title: 'Test Document',
        summary: 'Test summary',
        keywords: ['test'],
        category: 'tech_blog',
        sourceType: 'web',
        sourceUrl: 'https://example.com',
        rawContent: 'Content',
        metadata: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        chunkCount: 5,
      });

      const result = await documentService.getDocumentById('1');

      expect(result).not.toBeNull();
      expect(result!.chunkCount).toBe(5);
    });

    it('should return null if document not found', async () => {
      vi.mocked(mockRepo.getDocumentById).mockResolvedValue(null);

      const result = await documentService.getDocumentById('non-existent');

      expect(result).toBeNull();
    });
  });

  describe('deleteDocument', () => {
    it('should delete document', async () => {
      vi.mocked(mockRepo.deleteDocument).mockResolvedValue(true);

      const result = await documentService.deleteDocument('1');

      expect(result).toBe(true);
    });

    it('should return false if document not found', async () => {
      vi.mocked(mockRepo.deleteDocument).mockResolvedValue(false);

      const result = await documentService.deleteDocument('non-existent');

      expect(result).toBe(false);
    });
  });
});
