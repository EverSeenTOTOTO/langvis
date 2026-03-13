import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import { FileService } from '@/server/service/FileService';

describe('FileService', () => {
  let fileService: FileService;
  const testFileName = 'test-file.txt';
  const testContent = 'Test file content';
  const uploadDir = path.join(process.cwd(), 'upload');

  beforeAll(async () => {
    fileService = new FileService();

    // Ensure upload directory exists
    await fs.mkdir(uploadDir, { recursive: true });

    // Create test file
    await fs.writeFile(path.join(uploadDir, testFileName), testContent);
  });

  afterAll(async () => {
    // Clean up test files
    try {
      await fs.unlink(path.join(uploadDir, testFileName));
    } catch {
      // File might not exist, ignore error
    }
  });

  it('should download existing file', async () => {
    const buffer = await fileService.downloadFile(testFileName);
    expect(buffer).not.toBeNull();
    expect(buffer?.toString()).toBe(testContent);
  });

  it('should return null for non-existing file', async () => {
    const buffer = await fileService.downloadFile('non-existing.txt');
    expect(buffer).toBeNull();
  });

  it('should get file stats for existing file', async () => {
    const stats = await fileService.getFileStats(testFileName);
    expect(stats).not.toBeNull();
    expect(stats?.size).toBeGreaterThan(0);
    expect(stats?.mtime).toBeInstanceOf(Date);
  });

  it('should return null stats for non-existing file', async () => {
    const stats = await fileService.getFileStats('non-existing.txt');
    expect(stats).toBeNull();
  });

  it('should get correct file path', () => {
    const filePath = fileService.getFilePath(testFileName);
    expect(filePath).toBe(path.join(uploadDir, testFileName));
  });
});

describe('FileService - Extended', () => {
  let fileService: FileService;
  const uploadDir = path.join(process.cwd(), 'upload');
  const testFiles: string[] = [];

  beforeAll(async () => {
    fileService = new FileService();
    await fs.mkdir(uploadDir, { recursive: true });
  });

  afterAll(async () => {
    // Clean up all test files
    for (const filename of testFiles) {
      try {
        await fs.unlink(path.join(uploadDir, filename));
      } catch {
        // Ignore
      }
    }
  });

  describe('saveFile', () => {
    it('should save file and return metadata', async () => {
      const mockFile = {
        originalname: 'test-upload.txt',
        buffer: Buffer.from('test content'),
        size: 12,
        mimetype: 'text/plain',
      } as Express.Multer.File;

      const result = await fileService.saveFile(mockFile);
      testFiles.push(result.filename);

      expect(result.filename).toMatch(/^\d+-[a-z0-9]+\.txt$/);
      expect(result.size).toBe(12);
      expect(result.mimeType).toBe('text/plain');
      expect(result.url).toContain('/api/files/play/');

      // Verify file exists
      const stats = await fs.stat(path.join(uploadDir, result.filename));
      expect(stats.size).toBe(12);
    });

    it('should generate unique filenames', async () => {
      const mockFile1 = {
        originalname: 'duplicate.txt',
        buffer: Buffer.from('content 1'),
        size: 9,
        mimetype: 'text/plain',
      } as Express.Multer.File;

      const mockFile2 = {
        originalname: 'duplicate.txt',
        buffer: Buffer.from('content 2'),
        size: 9,
        mimetype: 'text/plain',
      } as Express.Multer.File;

      const result1 = await fileService.saveFile(mockFile1);
      const result2 = await fileService.saveFile(mockFile2);
      testFiles.push(result1.filename, result2.filename);

      expect(result1.filename).not.toBe(result2.filename);
    });
  });

  describe('listFiles', () => {
    beforeEach(async () => {
      // Create some test files
      const files = [
        { name: `list-test-1-${Date.now()}.txt`, content: 'content 1' },
        { name: `list-test-2-${Date.now()}.txt`, content: 'content 2' },
      ];
      for (const f of files) {
        await fs.writeFile(path.join(uploadDir, f.name), f.content);
        testFiles.push(f.name);
      }
    });

    it('should list files with pagination', async () => {
      const result = await fileService.listFiles({ page: 1, pageSize: 10 });

      expect(result.items.length).toBeGreaterThanOrEqual(2);
      expect(result.total).toBeGreaterThanOrEqual(2);

      const item = result.items[0];
      expect(item.filename).toBeDefined();
      expect(item.size).toBeGreaterThan(0);
      expect(item.mimeType).toBeDefined();
      expect(item.createdAt).toBeInstanceOf(Date);
      expect(item.url).toContain('/api/files/download/');
    });

    it('should paginate correctly', async () => {
      const result1 = await fileService.listFiles({ page: 1, pageSize: 1 });
      const result2 = await fileService.listFiles({ page: 2, pageSize: 1 });

      expect(result1.items.length).toBe(1);
      expect(result2.items.length).toBeLessThanOrEqual(1);
      if (result2.items.length > 0) {
        expect(result1.items[0].filename).not.toBe(result2.items[0].filename);
      }
    });
  });

  describe('deleteFile', () => {
    it('should delete existing file', async () => {
      // Create a file to delete
      const filename = `delete-test-${Date.now()}.txt`;
      await fs.writeFile(path.join(uploadDir, filename), 'to delete');

      await fileService.deleteFile(filename);

      // Verify file is gone
      const exists = await fs
        .access(path.join(uploadDir, filename))
        .then(() => true)
        .catch(() => false);
      expect(exists).toBe(false);
    });

    it('should throw for non-existing file', async () => {
      await expect(
        fileService.deleteFile('non-existing-file.txt'),
      ).rejects.toThrow();
    });
  });
});
