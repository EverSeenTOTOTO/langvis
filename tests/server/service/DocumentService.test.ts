import { DocumentService } from '@/server/service/DocumentService';
import { DatabaseService } from '@/server/service/DatabaseService';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the DatabaseService module
vi.mock('@/server/service/DatabaseService', () => ({
  DatabaseService: vi.fn().mockImplementation(() => ({
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
  })),
}));

describe('DocumentService', () => {
  let documentService: DocumentService;
  let mockDb: DatabaseService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb = new DatabaseService();
    documentService = new DocumentService(mockDb);
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

      (mockDb.getRepository as any).mockReturnValueOnce({
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

    it('should list documents with keyword filter using OR for title and keywords', async () => {
      const mockFindAndCount = vi.fn(async () => [[], 0]);
      (mockDb.getRepository as any).mockReturnValueOnce({
        findAndCount: mockFindAndCount,
        findOneBy: vi.fn(),
        delete: vi.fn(),
      } as any);

      await documentService.listDocuments({ keyword: 'react' });

      expect(mockFindAndCount).toHaveBeenCalled();
      const callArg = mockFindAndCount.mock.calls[0] as any[];
      const where = callArg[0].where;
      // Should use array-based OR condition for title and keywords
      expect(Array.isArray(where)).toBe(true);
      expect(where).toHaveLength(2);
      // First condition: title LIKE
      expect(where[0].title._value).toBe('%react%');
      // Second condition: keywords LIKE
      expect(where[1].keywords._value).toBe('%react%');
    });

    it('should use fuzzy search for title field', async () => {
      const mockFindAndCount = vi.fn(async () => [[], 0]);
      (mockDb.getRepository as any).mockReturnValueOnce({
        findAndCount: mockFindAndCount,
        findOneBy: vi.fn(),
        delete: vi.fn(),
      } as any);

      await documentService.listDocuments({ keyword: 'typescript' });

      expect(mockFindAndCount).toHaveBeenCalled();
      const callArg = mockFindAndCount.mock.calls[0] as any[];
      const where = callArg[0].where;
      // Check that fuzzy match pattern is applied
      expect(where[0].title._value).toBe('%typescript%');
    });

    it('should use fuzzy search for keywords field', async () => {
      const mockFindAndCount = vi.fn(async () => [[], 0]);
      (mockDb.getRepository as any).mockReturnValueOnce({
        findAndCount: mockFindAndCount,
        findOneBy: vi.fn(),
        delete: vi.fn(),
      } as any);

      await documentService.listDocuments({ keyword: 'nodejs' });

      expect(mockFindAndCount).toHaveBeenCalled();
      const callArg = mockFindAndCount.mock.calls[0] as any[];
      const where = callArg[0].where;
      // Check that fuzzy match pattern is applied to keywords
      expect(where[1].keywords._value).toBe('%nodejs%');
    });

    it('should combine keyword with category filter', async () => {
      const mockFindAndCount = vi.fn(async () => [[], 0]);
      (mockDb.getRepository as any).mockReturnValueOnce({
        findAndCount: mockFindAndCount,
        findOneBy: vi.fn(),
        delete: vi.fn(),
      } as any);

      await documentService.listDocuments({
        keyword: 'test',
        category: 'tech_blog',
      });

      expect(mockFindAndCount).toHaveBeenCalled();
      const callArg = mockFindAndCount.mock.calls[0] as any[];
      const where = callArg[0].where;
      // Both OR conditions should have category filter
      expect(where[0].category).toBe('tech_blog');
      expect(where[1].category).toBe('tech_blog');
    });

    it('should list documents with category filter', async () => {
      const mockFindAndCount = vi.fn(async () => [[], 0]);
      (mockDb.getRepository as any).mockReturnValueOnce({
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
      (mockDb.getRepository as any).mockReturnValueOnce({
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

      (mockDb.getRepository as any).mockReturnValueOnce({
        findAndCount: vi.fn(),
        findOneBy: vi.fn(async () => mockDocument),
        delete: vi.fn(),
      } as any);

      (mockDb.getRepository as any).mockReturnValueOnce({
        count: vi.fn(async () => 5),
        delete: vi.fn(),
      } as any);

      const result = await documentService.getDocumentById('1');

      expect(result).not.toBeNull();
      expect(result!.chunkCount).toBe(5);
    });

    it('should return null if document not found', async () => {
      (mockDb.getRepository as any).mockReturnValueOnce({
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
      (mockDb.getRepository as any).mockReturnValueOnce({
        findAndCount: vi.fn(),
        findOneBy: vi.fn(),
        delete: vi.fn(async () => ({ affected: 1 })),
      } as any);

      const result = await documentService.deleteDocument('1');

      expect(result).toBe(true);
    });

    it('should return false if document not found', async () => {
      (mockDb.getRepository as any).mockReturnValueOnce({
        findAndCount: vi.fn(),
        findOneBy: vi.fn(),
        delete: vi.fn(async () => ({ affected: 0 })),
      } as any);

      const result = await documentService.deleteDocument('non-existent');

      expect(result).toBe(false);
    });
  });
});
