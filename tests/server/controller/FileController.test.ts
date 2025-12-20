import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  vi,
  beforeEach,
} from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import { container } from 'tsyringe';
import { FileController } from '@/server/controller/FileController';
import { FileService } from '@/server/service/FileService';
import type { Request, Response } from 'express';

describe('FileController', () => {
  let controller: FileController;
  let mockFileService: Partial<FileService>;
  const testFileName = 'test-file.txt';
  const testImageName = 'test-image.jpg';
  const testDocName = 'test-doc.docx';
  const uploadDir = path.join(process.cwd(), 'upload');

  const mockRequest = (filename?: string) =>
    ({
      params: filename ? { 0: filename } : {},
    }) as Request;

  const mockResponse = () => {
    const res = {} as Response;
    res.status = vi.fn().mockReturnValue(res);
    res.json = vi.fn().mockReturnValue(res);
    res.send = vi.fn().mockReturnValue(res);
    res.setHeader = vi.fn().mockReturnValue(res);
    return res;
  };

  beforeAll(async () => {
    // Ensure upload directory exists
    await fs.mkdir(uploadDir, { recursive: true });

    // Create test files
    await fs.writeFile(path.join(uploadDir, testFileName), 'Test file content');
    await fs.writeFile(
      path.join(uploadDir, testImageName),
      'Fake image content',
    );
    await fs.writeFile(
      path.join(uploadDir, testDocName),
      'Fake document content',
    );

    // Set environment variables for allowed extensions
    process.env.FILE_INLINE_EXTENSIONS = '.txt,.jpg,.png,.pdf';
    process.env.FILE_RANGE_EXTENSIONS = '.mp4,.webm,.mp3';
  });

  beforeEach(() => {
    // Reset container
    container.clearInstances();

    // Create mock FileService
    mockFileService = {
      downloadFile: vi.fn(),
      getFileStats: vi.fn(),
      getFilePath: vi.fn(),
    };

    // Register mock service
    container.register(FileService, { useValue: mockFileService });
    controller = container.resolve(FileController);
  });

  afterAll(async () => {
    // Clean up test files
    const testFiles = [testFileName, testImageName, testDocName];
    for (const file of testFiles) {
      try {
        await fs.unlink(path.join(uploadDir, file));
      } catch {
        // File might not exist, ignore error
      }
    }
  });

  describe('downloadFile', () => {
    it('should download existing file with attachment disposition', async () => {
      const req = mockRequest(testFileName);
      const res = mockResponse();
      const fileBuffer = Buffer.from('Test file content');
      const fileStats = { size: 17, mtime: new Date('2023-01-01') };

      (mockFileService.getFileStats as any).mockResolvedValue(fileStats);
      (mockFileService.downloadFile as any).mockResolvedValue(fileBuffer);

      await controller.downloadFile(req, res);

      expect(res.setHeader).toHaveBeenCalledWith(
        'Content-Disposition',
        expect.stringContaining('attachment'),
      );
      expect(res.setHeader).toHaveBeenCalledWith(
        'Content-Disposition',
        expect.stringContaining(testFileName),
      );
      expect(res.send).toHaveBeenCalledWith(fileBuffer);
    });

    it('should return 404 for non-existing file', async () => {
      const req = mockRequest('non-existing.txt');
      const res = mockResponse();

      (mockFileService.getFileStats as any).mockResolvedValue(null);

      await controller.downloadFile(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({
        error: 'File not found',
      });
    });
  });

  describe('playFile', () => {
    it('should play allowed file type with inline disposition', async () => {
      const req = mockRequest(testFileName);
      const res = mockResponse();
      const fileBuffer = Buffer.from('Test file content');
      const fileStats = { size: 17, mtime: new Date('2023-01-01') };

      (mockFileService.getFileStats as any).mockResolvedValue(fileStats);
      (mockFileService.downloadFile as any).mockResolvedValue(fileBuffer);

      await controller.playFile(req, res);

      expect(res.setHeader).toHaveBeenCalledWith(
        'Content-Disposition',
        expect.stringContaining('inline'),
      );
      expect(res.setHeader).toHaveBeenCalledWith(
        'Content-Disposition',
        expect.stringContaining(testFileName),
      );
      expect(res.send).toHaveBeenCalledWith(fileBuffer);
    });

    it('should return 403 for disallowed file type', async () => {
      const req = mockRequest(testDocName);
      const res = mockResponse();

      await controller.playFile(req, res);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.stringContaining(
            'File type not allowed for inline viewing',
          ),
          allowedExtensions: expect.any(Array),
        }),
      );
    });

    it('should return 404 for non-existing file', async () => {
      const req = mockRequest('non-existing.txt');
      const res = mockResponse();

      (mockFileService.getFileStats as any).mockResolvedValue(null);

      await controller.playFile(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({
        error: 'File not found',
      });
    });
  });

  describe('getFileInfo', () => {
    it('should return file info for existing file', async () => {
      const req = mockRequest(testFileName);
      const res = mockResponse();
      const fileStats = { size: 17, mtime: new Date('2023-01-01') };

      (mockFileService.getFileStats as any).mockResolvedValue(fileStats);

      await controller.getFileInfo(req, res);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          filename: testFileName,
          size: 17,
          mtime: fileStats.mtime,
          mimeType: expect.any(String),
        }),
      );
    });

    it('should return 404 for non-existing file', async () => {
      const req = mockRequest('non-existing.txt');
      const res = mockResponse();

      (mockFileService.getFileStats as any).mockResolvedValue(null);

      await controller.getFileInfo(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({
        error: 'File not found',
      });
    });
  });
});
