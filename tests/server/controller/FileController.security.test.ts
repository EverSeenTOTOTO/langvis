import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  vi,
} from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import { container } from 'tsyringe';
import FileController from '@/server/controller/FileController';
import { FileService } from '@/server/service/FileService';
import type { Request, Response } from 'express';

describe('FileController Security Tests', () => {
  let controller: FileController;
  let fileService: FileService;
  const uploadDir = path.join(process.cwd(), 'upload');
  const testFileName = 'test-file.txt';
  const secretFileName = 'secret.txt';
  const secretContent = 'This is secret content that should not be accessible';

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

    // Add stream-like properties for pipe functionality
    res.pipe = vi.fn().mockReturnValue(res);
    res.on = vi.fn().mockReturnValue(res);
    res.once = vi.fn().mockReturnValue(res);
    res.emit = vi.fn().mockReturnValue(res);
    res.removeListener = vi.fn().mockReturnValue(res);
    res.write = vi.fn().mockReturnValue(res);
    res.end = vi.fn().mockReturnValue(res);

    return res;
  };

  beforeAll(async () => {
    // Ensure upload directory exists
    await fs.mkdir(uploadDir, { recursive: true });

    // Create test file in upload directory
    await fs.writeFile(path.join(uploadDir, testFileName), 'Test file content');

    // Create secret file outside upload directory
    await fs.writeFile(path.join(process.cwd(), secretFileName), secretContent);

    // Set environment variables for allowed extensions
    process.env.FILE_INLINE_EXTENSIONS = '.txt,.jpg,.png,.pdf';
    process.env.FILE_RANGE_EXTENSIONS = '.mp4,.webm,.mp3';
  });

  beforeEach(() => {
    // Reset container
    container.clearInstances();

    // Register real service for security testing
    container.register(FileService, { useClass: FileService });
    controller = container.resolve(FileController);
    fileService = container.resolve(FileService);
  });

  afterAll(async () => {
    // Clean up test files
    try {
      await fs.unlink(path.join(uploadDir, testFileName));
      await fs.unlink(path.join(process.cwd(), secretFileName));
    } catch {
      // Files might not exist, ignore error
    }
  });

  describe('Path Traversal Attack Prevention', () => {
    const pathTraversalPayloads = [
      '../secret.txt',
      '..\\secret.txt',
      '....//secret.txt',
      '....\\\\secret.txt',
      '../../secret.txt',
      '..//../secret.txt',
      'subdir/../../secret.txt',
      '/etc/passwd',
      '\\windows\\system32\\drivers\\etc\\hosts',
    ];

    pathTraversalPayloads.forEach(payload => {
      it(`should prevent path traversal with payload: ${payload}`, async () => {
        const req = mockRequest(payload);
        const res = mockResponse();

        await controller.downloadFile(req, res);

        // Should return 500 error due to security validation failure
        expect(res.status).toHaveBeenCalledWith(500);
        expect(res.json).toHaveBeenCalledWith({
          error: 'Internal server error',
        });
      });

      it(`should prevent path traversal in playFile with payload: ${payload}`, async () => {
        const req = mockRequest(payload);
        const res = mockResponse();

        // Special case: absolute system paths like /etc/passwd are blocked by extension validation first
        if (
          payload === '/etc/passwd' ||
          payload === '\\windows\\system32\\drivers\\etc\\hosts'
        ) {
          await controller.playFile(req, res);
          expect(res.status).toHaveBeenCalledWith(403);
          expect(res.json).toHaveBeenCalledWith(
            expect.objectContaining({
              error: 'File type not allowed for inline viewing',
            }),
          );
        } else {
          // All other malicious paths should result in 500 error due to validation failure
          await controller.playFile(req, res);
          expect(res.status).toHaveBeenCalledWith(500);
          expect(res.json).toHaveBeenCalledWith({
            error: 'Internal server error',
          });
        }
      });

      it(`should prevent path traversal in getFileInfo with payload: ${payload}`, async () => {
        const req = mockRequest(payload);
        const res = mockResponse();

        await controller.getFileInfo(req, res);

        // Should return 500 error due to security validation failure
        expect(res.status).toHaveBeenCalledWith(500);
        expect(res.json).toHaveBeenCalledWith({
          error: 'Internal server error',
        });
      });
    });

    // Test URL-encoded payloads separately as they should be handled differently
    const urlEncodedPayloads = [
      '..%2fsecret.txt',
      '..%5csecret.txt',
      '..%252fsecret.txt',
      '..%255csecret.txt',
    ];

    urlEncodedPayloads.forEach(payload => {
      it(`should handle URL-encoded path traversal payload: ${payload}`, async () => {
        const req = mockRequest(payload);
        const res = mockResponse();

        await controller.downloadFile(req, res);

        // Should return 500 error due to security validation failure
        expect(res.status).toHaveBeenCalledWith(500);
        expect(res.json).toHaveBeenCalledWith({
          error: 'Internal server error',
        });
      });
    });

    // These URL-encoded payloads that don't contain ".." should return 404
    const safeUrlEncodedPayloads = [
      '%2e%2e/secret.txt',
      '%2e%2e%2fsecret.txt',
      '%2e%2e%5csecret.txt',
    ];

    safeUrlEncodedPayloads.forEach(payload => {
      it(`should handle safe URL-encoded payload: ${payload}`, async () => {
        const req = mockRequest(payload);
        const res = mockResponse();

        await controller.downloadFile(req, res);

        // Should return 500 error due to security validation failure
        expect(res.status).toHaveBeenCalledWith(500);
        expect(res.json).toHaveBeenCalledWith({
          error: 'Internal server error',
        });
      });
    });
  });

  describe('FileService Security Tests', () => {
    it('should prevent directory traversal in downloadFile', async () => {
      try {
        await fileService.downloadFile('../secret.txt');
        // Should not reach here
        expect(true).toBe(false);
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toContain('Invalid');
      }
    });

    it('should prevent directory traversal in getFileStats', async () => {
      try {
        await fileService.getFileStats('../secret.txt');
        // Should not reach here
        expect(true).toBe(false);
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toContain('Invalid');
      }
    });

    it('should throw error for invalid paths in downloadFile', async () => {
      try {
        await fileService.downloadFile('../../etc/passwd');
        // Should not reach here
        expect(true).toBe(false);
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toContain('Invalid');
      }
    });

    it('should throw error for invalid paths in getFileStats', async () => {
      try {
        await fileService.getFileStats('../../etc/passwd');
        // Should not reach here
        expect(true).toBe(false);
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toContain('Invalid');
      }
    });
  });

  describe('Filename Validation', () => {
    const invalidFilenames = [
      '',
      null,
      undefined,
      'file\x00name.txt', // null byte injection
      'file\nname.txt', // newline injection
      'file\rname.txt', // carriage return injection
    ];

    invalidFilenames.forEach(filename => {
      it(`should handle invalid filename: ${JSON.stringify(filename)}`, async () => {
        const req = mockRequest(filename as string);
        const res = mockResponse();

        if (filename === '' || filename === null || filename === undefined) {
          // These should return 400 bad request
          await controller.downloadFile(req, res);
          expect(res.status).toHaveBeenCalledWith(400);
          expect(res.json).toHaveBeenCalledWith({
            error: 'Filename is required',
          });
        } else {
          // These should return 500 error due to validation failure
          await controller.downloadFile(req, res);
          expect(res.status).toHaveBeenCalledWith(500);
          expect(res.json).toHaveBeenCalledWith({
            error: 'Internal server error',
          });
        }
      });
    });

    // Test tab injection separately as it might be handled differently
    it('should handle tab injection in filename', async () => {
      const req = mockRequest('file\tname.txt');
      const res = mockResponse();

      await controller.downloadFile(req, res);

      // Should return 500 error due to security validation failure
      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Internal server error',
      });
    });
  });

  describe('getFilePath Security', () => {
    it('should now have path traversal protection in getFilePath', () => {
      try {
        fileService.getFilePath('../secret.txt');
        // Should not reach here
        expect(true).toBe(false);
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toContain('Invalid');
      }
    });

    it('should work with valid filenames', () => {
      const validPath = fileService.getFilePath('test-file.txt');
      expect(validPath).toContain('upload');
      expect(validPath).toContain('test-file.txt');
      expect(validPath).not.toContain('..');
    });
  });
});
