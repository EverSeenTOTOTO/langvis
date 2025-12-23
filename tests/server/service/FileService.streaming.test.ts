import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import { FileService } from '@/server/service/FileService';

describe('FileService - Streaming', () => {
  let fileService: FileService;
  const testFileName = 'stream-test.txt';
  const uploadDir = path.join(process.cwd(), 'upload');
  const testContent = 'This is a test file for streaming functionality.';

  beforeAll(async () => {
    // Ensure upload directory exists
    await fs.mkdir(uploadDir, { recursive: true });

    // Create test file
    await fs.writeFile(path.join(uploadDir, testFileName), testContent);

    fileService = new FileService();
  });

  afterAll(async () => {
    // Clean up test file
    try {
      await fs.unlink(path.join(uploadDir, testFileName));
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('createReadStream', () => {
    it('should create a readable stream for existing file', async () => {
      const stream = await fileService.createReadStream(testFileName);

      expect(stream).toBeDefined();
      expect(typeof stream.pipe).toBe('function');

      // Read stream content
      const chunks: Buffer[] = [];
      stream.on('data', (chunk: Buffer) => {
        chunks.push(chunk);
      });

      await new Promise<void>((resolve, reject) => {
        stream.on('end', resolve);
        stream.on('error', reject);
      });

      const content = Buffer.concat(chunks).toString();
      expect(content).toBe(testContent);
    });

    it('should create a partial stream with start and end options', async () => {
      const stream = await fileService.createReadStream(testFileName, {
        start: 5,
        end: 15,
      });

      expect(stream).toBeDefined();

      // Read stream content
      const chunks: Buffer[] = [];
      stream.on('data', (chunk: Buffer) => {
        chunks.push(chunk);
      });

      await new Promise<void>((resolve, reject) => {
        stream.on('end', resolve);
        stream.on('error', reject);
      });

      const content = Buffer.concat(chunks).toString();
      expect(content).toBe(testContent.slice(5, 16)); // end is inclusive
    });

    it('should reject with error for non-existing file', async () => {
      await expect(
        fileService.createReadStream('non-existing.txt'),
      ).rejects.toThrow('File not found');
    });

    it('should reject with error for invalid filename', async () => {
      await expect(
        fileService.createReadStream('../../../etc/passwd'),
      ).rejects.toThrow('Invalid filename');
    });
  });
});
