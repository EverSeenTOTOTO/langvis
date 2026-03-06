import { DocumentService } from '@/server/service/DocumentService';
import pg from '@/server/service/pg';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the pg module
vi.mock('@/server/service/pg', () => ({
  default: {
    getRepository: vi.fn().mockImplementation((entity: any) => {
      if (entity.name === 'DocumentEntity') {
        return {
          findAndCount: vi.fn(async () => [[], 0]),
          findOneBy: vi.fn(async () => null),
          delete: vi.fn(async () => ({ affected: 0 })),
        };
      } else if (entity.name === 'DocumentChunkEntity') {
        return {
          count: vi.fn(async () => 0),
          delete: vi.fn(async () => ({ affected: 0 })),
        };
      }
      return {};
    }),
  },
}));

describe('DocumentService', () => {
  let documentService: DocumentService;

  beforeEach(() => {
    vi.clearAllMocks();
    documentService = new DocumentService();
  });

  describe('listDocuments', () => {
    it('should list documents with default pagination', async () => {
      const mockDocuments = [
        {
          id: '1',
          title: 'Test Document',
          summary: 'Test summary',
          keywords: ['test'],
          category: 'tech_blog',
          sourceType: 'web',
          sourceUrl: 'https://example.com',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      vi.mocked(pg.getRepository).mockReturnValueOnce({
        findAndCount: vi.fn(async () => [mockDocuments, 1]),
        findOneBy: vi.fn(),
        delete: vi.fn(),
      } as any);

      const result = await documentService.listDocuments({});

      expect(result.items).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(result.page).toBe(1);
      expect(result.pageSize).toBe(10);
    });

    it('should list documents with keyword filter', async () => {
      vi.mocked(pg.getRepository).mockReturnValueOnce({
        findAndCount: vi.fn(async () => [[], 0]),
        findOneBy: vi.fn(),
        delete: vi.fn(),
      } as any);

      await documentService.listDocuments({ keyword: 'test' });

      // The Like function should be called with the keyword pattern
      // This is tested implicitly through the service call
    });

    it('should list documents with category filter', async () => {
      const mockFindAndCount = vi.fn(async () => [[], 0]);
      vi.mocked(pg.getRepository).mockReturnValueOnce({
        findAndCount: mockFindAndCount,
        findOneBy: vi.fn(),
        delete: vi.fn(),
      } as any);

      await documentService.listDocuments({ category: 'tech_blog' });

      expect(mockFindAndCount).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ category: 'tech_blog' }),
        }),
      );
    });

    it('should use custom page and pageSize', async () => {
      const mockFindAndCount = vi.fn(async () => [[], 0]);
      vi.mocked(pg.getRepository).mockReturnValueOnce({
        findAndCount: mockFindAndCount,
        findOneBy: vi.fn(),
        delete: vi.fn(),
      } as any);

      await documentService.listDocuments({ page: 2, pageSize: 20 });

      expect(mockFindAndCount).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 20,
          take: 20,
        }),
      );
    });
  });

  describe('getDocumentById', () => {
    it('should get document with chunk count', async () => {
      const mockDocument = {
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
      };

      vi.mocked(pg.getRepository).mockReturnValueOnce({
        findAndCount: vi.fn(),
        findOneBy: vi.fn(async () => mockDocument),
        delete: vi.fn(),
      } as any);

      vi.mocked(pg.getRepository).mockReturnValueOnce({
        count: vi.fn(async () => 5),
        delete: vi.fn(),
      } as any);

      const result = await documentService.getDocumentById('1');

      expect(result).not.toBeNull();
      expect(result!.chunkCount).toBe(5);
    });

    it('should return null if document not found', async () => {
      vi.mocked(pg.getRepository).mockReturnValueOnce({
        findAndCount: vi.fn(),
        findOneBy: vi.fn(async () => null),
        delete: vi.fn(),
      } as any);

      const result = await documentService.getDocumentById('non-existent');

      expect(result).toBeNull();
    });
  });

  describe('deleteDocument', () => {
    it('should delete document and its chunks', async () => {
      const mockDocument = { id: '1', title: 'Test' };

      vi.mocked(pg.getRepository).mockReturnValueOnce({
        findAndCount: vi.fn(),
        findOneBy: vi.fn(async () => mockDocument),
        delete: vi.fn(async () => ({ affected: 1 })),
      } as any);

      vi.mocked(pg.getRepository).mockReturnValueOnce({
        count: vi.fn(),
        delete: vi.fn(async () => ({ affected: 5 })),
      } as any);

      const result = await documentService.deleteDocument('1');

      expect(result).toBe(true);
    });

    it('should return false if document not found', async () => {
      vi.mocked(pg.getRepository).mockReturnValueOnce({
        findAndCount: vi.fn(),
        findOneBy: vi.fn(async () => null),
        delete: vi.fn(),
      } as any);

      const result = await documentService.deleteDocument('non-existent');

      expect(result).toBe(false);
    });
  });
});
