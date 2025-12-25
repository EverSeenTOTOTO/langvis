import { describe, it, expect, beforeAll, vi, beforeEach } from 'vitest';
import { container } from 'tsyringe';
import FileController from '@/server/controller/FileController';
import { FileService } from '@/server/service/FileService';
import type { Request, Response } from 'express';
import { Readable } from 'stream';

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

      await controller.downloadFile(req, res);

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

      await controller.downloadFile(req, res);

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

      await controller.downloadFile(req, res);

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

      await controller.playFile(req, res);

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

      await controller.playFile(req, res);

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

      await controller.playFile(req, res);

      // Should ignore range header for .txt files
      expect(mockFileService.createReadStream).toHaveBeenCalledWith('test.txt');
      expect(res.setHeader).not.toHaveBeenCalledWith('Accept-Ranges', 'bytes');
    });
  });
});
