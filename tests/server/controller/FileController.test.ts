import FileController from '@/server/controller/FileController';
import { FileService } from '@/server/service/FileService';
import type { Request, Response } from 'express';
import { Readable } from 'stream';
import { container } from 'tsyringe';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

describe('FileController - Streaming', () => {
  let controller: FileController;
  let mockFileService: Partial<FileService>;
  const testFileName = 'test-video.mp4';
  const testContent = 'This is test video content for streaming';

  const mockRequest = (
    filename?: string,
    headers: Record<string, string> = {},
  ) =>
    ({
      params: filename ? { 0: filename } : {},
      headers,
    }) as Request;

  const mockResponse = () => {
    const res = {} as Response;
    res.status = vi.fn().mockReturnValue(res);
    res.json = vi.fn().mockReturnValue(res);
    res.send = vi.fn().mockReturnValue(res);
    res.setHeader = vi.fn().mockReturnValue(res);

    // Mock the pipe functionality for streams
    const mockPipe = vi.fn();
    res.pipe = mockPipe;

    // Add necessary stream-like properties for pipe to work
    res.on = vi.fn().mockReturnValue(res);
    res.once = vi.fn().mockReturnValue(res);
    res.emit = vi.fn().mockReturnValue(res);
    res.removeListener = vi.fn().mockReturnValue(res);
    res.write = vi.fn().mockReturnValue(res);
    res.end = vi.fn().mockReturnValue(res);

    return res;
  };

  const createMockStream = (
    content: string,
    options?: { start?: number; end?: number },
  ) => {
    let sliceContent = content;
    if (options?.start !== undefined || options?.end !== undefined) {
      const start = options.start || 0;
      const end = options.end !== undefined ? options.end + 1 : content.length;
      sliceContent = content.slice(start, end);
    }

    const stream = new Readable();
    stream.push(sliceContent);
    stream.push(null);
    return stream;
  };

  beforeAll(() => {
    // Set environment variables for allowed extensions
    process.env.FILE_INLINE_EXTENSIONS = '.txt,.jpg,.png,.pdf,.mp4';
    process.env.FILE_RANGE_EXTENSIONS = '.mp4,.webm,.mp3';
  });

  beforeEach(() => {
    // Reset container
    container.clearInstances();

    // Create mock FileService
    mockFileService = {
      getFileStats: vi.fn(),
      createReadStream: vi.fn(),
    };

    // Register mock service
    container.register(FileService, { useValue: mockFileService });
    controller = container.resolve(FileController);
  });

  describe('downloadFile with streaming', () => {
    it('should stream entire file when no range header', async () => {
      const req = mockRequest(testFileName);
      const res = mockResponse();
      const fileStats = {
        size: testContent.length,
        mtime: new Date('2023-01-01'),
      };
      const mockStream = createMockStream(testContent);

      (mockFileService.getFileStats as any).mockResolvedValue(fileStats);
      (mockFileService.createReadStream as any).mockResolvedValue(mockStream);

      await controller.downloadFile(testFileName, req, res);

      expect(mockFileService.createReadStream).toHaveBeenCalledWith(
        testFileName,
      );
      expect(res.setHeader).toHaveBeenCalledWith(
        'Content-Length',
        testContent.length,
      );
      expect(res.setHeader).toHaveBeenCalledWith('Accept-Ranges', 'bytes');
      expect(res.setHeader).toHaveBeenCalledWith(
        'Content-Disposition',
        expect.stringContaining('attachment'),
      );
    });

    it('should handle range requests for partial content', async () => {
      const req = mockRequest(testFileName, { range: 'bytes=0-9' });
      const res = mockResponse();
      const fileStats = {
        size: testContent.length,
        mtime: new Date('2023-01-01'),
      };
      const mockStream = createMockStream(testContent, { start: 0, end: 9 });

      (mockFileService.getFileStats as any).mockResolvedValue(fileStats);
      (mockFileService.createReadStream as any).mockResolvedValue(mockStream);

      await controller.downloadFile(testFileName, req, res);

      expect(mockFileService.createReadStream).toHaveBeenCalledWith(
        testFileName,
        { start: 0, end: 9 },
      );
      expect(res.status).toHaveBeenCalledWith(206);
      expect(res.setHeader).toHaveBeenCalledWith(
        'Content-Range',
        `bytes 0-9/${testContent.length}`,
      );
      expect(res.setHeader).toHaveBeenCalledWith('Content-Length', 10);
    });

    it('should return 416 for invalid range', async () => {
      const req = mockRequest(testFileName, { range: 'bytes=100-200' });
      const res = mockResponse();
      const fileStats = {
        size: testContent.length,
        mtime: new Date('2023-01-01'),
      };

      (mockFileService.getFileStats as any).mockResolvedValue(fileStats);

      await controller.downloadFile(testFileName, req, res);

      expect(res.status).toHaveBeenCalledWith(416);
      expect(res.setHeader).toHaveBeenCalledWith(
        'Content-Range',
        `bytes */${testContent.length}`,
      );
    });
  });

  describe('playFile with streaming', () => {
    it('should stream media file with range support', async () => {
      const req = mockRequest(testFileName);
      const res = mockResponse();
      const fileStats = {
        size: testContent.length,
        mtime: new Date('2023-01-01'),
      };
      const mockStream = createMockStream(testContent);

      (mockFileService.getFileStats as any).mockResolvedValue(fileStats);
      (mockFileService.createReadStream as any).mockResolvedValue(mockStream);

      await controller.playFile(testFileName, req, res);

      expect(mockFileService.createReadStream).toHaveBeenCalledWith(
        testFileName,
      );
      expect(res.setHeader).toHaveBeenCalledWith('Accept-Ranges', 'bytes');
      expect(res.setHeader).toHaveBeenCalledWith(
        'Content-Disposition',
        expect.stringContaining('inline'),
      );
      expect(res.setHeader).toHaveBeenCalledWith(
        'Cache-Control',
        'public, max-age=31536000',
      );
    });

    it('should handle range requests for media files', async () => {
      const req = mockRequest(testFileName, { range: 'bytes=5-14' });
      const res = mockResponse();
      const fileStats = {
        size: testContent.length,
        mtime: new Date('2023-01-01'),
      };
      const mockStream = createMockStream(testContent, { start: 5, end: 14 });

      (mockFileService.getFileStats as any).mockResolvedValue(fileStats);
      (mockFileService.createReadStream as any).mockResolvedValue(mockStream);

      await controller.playFile(testFileName, req, res);

      expect(mockFileService.createReadStream).toHaveBeenCalledWith(
        testFileName,
        { start: 5, end: 14 },
      );
      expect(res.status).toHaveBeenCalledWith(206);
      expect(res.setHeader).toHaveBeenCalledWith(
        'Content-Range',
        `bytes 5-14/${testContent.length}`,
      );
    });

    it('should not handle range requests for non-range supported files', async () => {
      const req = mockRequest('test.txt', { range: 'bytes=5-14' });
      const res = mockResponse();
      const fileStats = {
        size: testContent.length,
        mtime: new Date('2023-01-01'),
      };
      const mockStream = createMockStream(testContent);

      (mockFileService.getFileStats as any).mockResolvedValue(fileStats);
      (mockFileService.createReadStream as any).mockResolvedValue(mockStream);

      await controller.playFile('test.txt', req, res);

      // Should ignore range header for .txt files
      expect(mockFileService.createReadStream).toHaveBeenCalledWith('test.txt');
      expect(res.setHeader).not.toHaveBeenCalledWith('Accept-Ranges', 'bytes');
    });
  });
});

// Mock agent for validation tests
const createMockAgent = () => ({
  config: {
    name: 'MockAgent',
    description: 'Mock Agent for testing',
    upload: {
      maxSize: 1000, // 1KB
      allowedTypes: ['text/plain', 'image/*'],
      maxCount: 2,
    },
  },
});

describe('FileController - Upload', () => {
  let controller: FileController;
  let mockFileService: Partial<FileService>;

  beforeEach(() => {
    container.clearInstances();
    mockFileService = {
      saveFile: vi.fn(),
    };
    container.register(FileService, { useValue: mockFileService });
    container.register('MockAgent', { useValue: createMockAgent() });
    controller = container.resolve(FileController);
  });

  it('should upload file successfully', async () => {
    const mockFile = {
      fieldname: 'file',
      originalname: 'test.txt',
      buffer: Buffer.from('test'),
      size: 4,
      mimetype: 'text/plain',
    } as Express.Multer.File;

    const mockRes = {
      json: vi.fn(),
      status: vi.fn().mockReturnThis(),
    } as any;

    (mockFileService.saveFile as any).mockResolvedValue({
      filename: '1234567890-abc123.txt',
      url: '/api/files/download/1234567890-abc123.txt',
      size: 4,
      mimeType: 'text/plain',
    });

    await controller.uploadFile(mockFile, mockRes);

    expect(mockFileService.saveFile).toHaveBeenCalledWith(mockFile);
    expect(mockRes.json).toHaveBeenCalledWith({
      filename: '1234567890-abc123.txt',
      url: '/api/files/download/1234567890-abc123.txt',
      size: 4,
      mimeType: 'text/plain',
    });
  });

  it('should reject file with no file provided', async () => {
    const mockRes = {
      json: vi.fn(),
      status: vi.fn().mockReturnThis(),
    } as any;

    await controller.uploadFile(undefined as any, mockRes);

    expect(mockRes.status).toHaveBeenCalledWith(400);
    expect(mockRes.json).toHaveBeenCalledWith({ error: 'No file uploaded' });
  });

  it('should reject file exceeding maxSize', async () => {
    const mockFile = {
      fieldname: 'file',
      originalname: 'large.txt',
      buffer: Buffer.from('x'.repeat(2000)),
      size: 2000,
      mimetype: 'text/plain',
    } as Express.Multer.File;

    const mockRes = {
      json: vi.fn(),
      status: vi.fn().mockReturnThis(),
    } as any;

    await controller.uploadFile(mockFile, mockRes, { agent: 'MockAgent' });

    expect(mockRes.status).toHaveBeenCalledWith(400);
    expect(mockRes.json).toHaveBeenCalledWith({
      error: expect.stringContaining('exceeds limit'),
    });
  });

  it('should reject file with disallowed type', async () => {
    const mockFile = {
      fieldname: 'file',
      originalname: 'video.mp4',
      buffer: Buffer.from('test'),
      size: 4,
      mimetype: 'video/mp4',
    } as Express.Multer.File;

    const mockRes = {
      json: vi.fn(),
      status: vi.fn().mockReturnThis(),
    } as any;

    await controller.uploadFile(mockFile, mockRes, { agent: 'MockAgent' });

    expect(mockRes.status).toHaveBeenCalledWith(400);
    expect(mockRes.json).toHaveBeenCalledWith({
      error: expect.stringContaining('not allowed'),
    });
  });

  it('should accept file with wildcard type match', async () => {
    const mockFile = {
      fieldname: 'file',
      originalname: 'image.png',
      buffer: Buffer.from('test'),
      size: 4,
      mimetype: 'image/png',
    } as Express.Multer.File;

    const mockRes = {
      json: vi.fn(),
      status: vi.fn().mockReturnThis(),
    } as any;

    (mockFileService.saveFile as any).mockResolvedValue({
      filename: 'image.png',
      url: '/api/files/download/image.png',
      size: 4,
      mimeType: 'image/png',
    });

    await controller.uploadFile(mockFile, mockRes, { agent: 'MockAgent' });

    expect(mockFileService.saveFile).toHaveBeenCalled();
  });
});

describe('FileController - List and Delete', () => {
  let controller: FileController;
  let mockFileService: Partial<FileService>;

  beforeEach(() => {
    container.clearInstances();
    mockFileService = {
      listFiles: vi.fn(),
      deleteFile: vi.fn(),
    };
    container.register(FileService, { useValue: mockFileService });
    controller = container.resolve(FileController);
  });

  describe('listFiles', () => {
    it('should list files with default pagination', async () => {
      const mockRes = {
        json: vi.fn(),
        status: vi.fn().mockReturnThis(),
      } as any;

      (mockFileService.listFiles as any).mockResolvedValue({
        items: [
          {
            filename: 'file1.txt',
            size: 100,
            mimeType: 'text/plain',
            createdAt: new Date(),
            url: '/api/files/download/file1.txt',
          },
        ],
        total: 1,
      });

      await controller.listFiles({}, mockRes);

      expect(mockFileService.listFiles).toHaveBeenCalledWith({
        page: 1,
        pageSize: 20,
      });
      expect(mockRes.json).toHaveBeenCalled();
    });

    it('should list files with custom pagination', async () => {
      const mockRes = {
        json: vi.fn(),
        status: vi.fn().mockReturnThis(),
      } as any;

      (mockFileService.listFiles as any).mockResolvedValue({
        items: [],
        total: 0,
      });

      await controller.listFiles({ page: 2, pageSize: 10 }, mockRes);

      expect(mockFileService.listFiles).toHaveBeenCalledWith({
        page: 2,
        pageSize: 10,
      });
    });
  });

  describe('deleteFile', () => {
    it('should delete file successfully', async () => {
      const mockRes = {
        json: vi.fn(),
        status: vi.fn().mockReturnThis(),
      } as any;

      await controller.deleteFile('test.txt', mockRes);

      expect(mockFileService.deleteFile).toHaveBeenCalledWith('test.txt');
      expect(mockRes.json).toHaveBeenCalledWith({ success: true });
    });

    it('should handle delete error', async () => {
      const mockRes = {
        json: vi.fn(),
        status: vi.fn().mockReturnThis(),
      } as any;

      (mockFileService.deleteFile as any).mockRejectedValue(
        new Error('File not found'),
      );

      await controller.deleteFile('nonexistent.txt', mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Failed to delete file',
      });
    });
  });
});
