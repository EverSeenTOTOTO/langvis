import { describe, it, expect, beforeAll, afterAll } from 'vitest';
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
