import { describe, it, expect, beforeEach, vi } from 'vitest';
import DocumentController from '@/server/controller/DocumentController';
import type { Request, Response } from 'express';

describe('DocumentController', () => {
  let documentController: DocumentController;
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  const mockDocumentService = {
    listDocuments: vi.fn(),
    getDocumentById: vi.fn(),
    deleteDocument: vi.fn(),
  };

  beforeEach(() => {
    documentController = new DocumentController(mockDocumentService as any);
    mockReq = {
      user: { id: 'test-user-id' },
    };
    mockRes = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
      send: vi.fn().mockReturnThis(),
    };
  });

  describe('listDocuments', () => {
    it('should list documents with default pagination', async () => {
      const mockResult = {
        items: [
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
        ],
        total: 1,
        page: 1,
        pageSize: 10,
      };

      mockDocumentService.listDocuments.mockResolvedValue(mockResult);

      await documentController.listDocuments(
        {} as any,
        mockReq as Request,
        mockRes as Response,
      );

      expect(mockDocumentService.listDocuments).toHaveBeenCalledWith({
        keyword: undefined,
        category: undefined,
        startTime: undefined,
        endTime: undefined,
        page: undefined,
        pageSize: undefined,
      });
      expect(mockRes.json).toHaveBeenCalledWith(mockResult);
    });

    it('should list documents with filters', async () => {
      const mockResult = {
        items: [],
        total: 0,
        page: 1,
        pageSize: 20,
      };

      mockDocumentService.listDocuments.mockResolvedValue(mockResult);

      await documentController.listDocuments(
        {
          keyword: 'test',
          category: 'tech_blog',
          startTime: '2024-01-01T00:00:00Z',
          endTime: '2024-12-31T23:59:59Z',
          page: 1,
          pageSize: 20,
        } as any,
        mockReq as Request,
        mockRes as Response,
      );

      expect(mockDocumentService.listDocuments).toHaveBeenCalledWith({
        keyword: 'test',
        category: 'tech_blog',
        startTime: '2024-01-01T00:00:00Z',
        endTime: '2024-12-31T23:59:59Z',
        page: 1,
        pageSize: 20,
      });
      expect(mockRes.json).toHaveBeenCalledWith(mockResult);
    });

    it('should return 401 if user not authenticated', async () => {
      mockReq.user = undefined;

      await documentController.listDocuments(
        {} as any,
        mockReq as Request,
        mockRes as Response,
      );

      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith({ error: 'Unauthorized' });
    });
  });

  describe('getDocumentById', () => {
    it('should get document by id', async () => {
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
        chunkCount: 5,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockDocumentService.getDocumentById.mockResolvedValue(mockDocument);

      await documentController.getDocumentById(
        '1',
        mockReq as Request,
        mockRes as Response,
      );

      expect(mockDocumentService.getDocumentById).toHaveBeenCalledWith('1');
      expect(mockRes.json).toHaveBeenCalledWith(mockDocument);
    });

    it('should return 404 if document not found', async () => {
      mockDocumentService.getDocumentById.mockResolvedValue(null);

      await documentController.getDocumentById(
        'non-existent',
        mockReq as Request,
        mockRes as Response,
      );

      expect(mockRes.status).toHaveBeenCalledWith(404);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Document not found',
      });
    });

    it('should return 401 if user not authenticated', async () => {
      mockReq.user = undefined;

      await documentController.getDocumentById(
        '1',
        mockReq as Request,
        mockRes as Response,
      );

      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith({ error: 'Unauthorized' });
    });
  });

  describe('deleteDocument', () => {
    it('should delete document successfully', async () => {
      mockDocumentService.deleteDocument.mockResolvedValue(true);

      await documentController.deleteDocument(
        '1',
        mockReq as Request,
        mockRes as Response,
      );

      expect(mockDocumentService.deleteDocument).toHaveBeenCalledWith('1');
      expect(mockRes.json).toHaveBeenCalledWith({ success: true });
    });

    it('should return 404 if document not found', async () => {
      mockDocumentService.deleteDocument.mockResolvedValue(false);

      await documentController.deleteDocument(
        'non-existent',
        mockReq as Request,
        mockRes as Response,
      );

      expect(mockRes.status).toHaveBeenCalledWith(404);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Document not found',
      });
    });

    it('should return 401 if user not authenticated', async () => {
      mockReq.user = undefined;

      await documentController.deleteDocument(
        '1',
        mockReq as Request,
        mockRes as Response,
      );

      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith({ error: 'Unauthorized' });
    });
  });
});
