import { promises as fs } from 'fs';
import path from 'path';
import { beforeEach, afterAll, describe, expect, it } from 'vitest';
import { WorkspaceService } from '@/server/service/WorkspaceService';

describe('WorkspaceService', () => {
  let service: WorkspaceService;
  let testDir: string;

  beforeEach(async () => {
    service = new WorkspaceService();
    testDir = path.join('/tmp', `langvis-workspace-test-${Date.now()}`);
    // Override rootDir to use isolated test directory
    (service as any).rootDir = testDir;
    await fs.mkdir(testDir, { recursive: true });
  });

  afterAll(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  describe('getWorkDir', () => {
    it('should create workspace directory', async () => {
      const dir = await service.getWorkDir('conv-123');
      expect(dir).toContain('conv-123');
      const stat = await fs.stat(dir);
      expect(stat.isDirectory()).toBe(true);
    });

    it('should reuse existing directory', async () => {
      const dir1 = await service.getWorkDir('conv-123');
      const dir2 = await service.getWorkDir('conv-123');
      expect(dir1).toBe(dir2);
    });

    it('should create nested subdirectories', async () => {
      const dir = await service.getWorkDir('conv-456');
      await fs.mkdir(path.join(dir, 'a/b/c'), { recursive: true });
      const stat = await fs.stat(path.join(dir, 'a/b/c'));
      expect(stat.isDirectory()).toBe(true);
    });
  });

  describe('readFile', () => {
    it('should read existing file', async () => {
      const workDir = await service.getWorkDir('conv-read');
      await fs.writeFile(path.join(workDir, 'test.txt'), 'hello world');
      const result = await service.readFile('test.txt', workDir);
      expect(result).not.toBeNull();
      expect(result!.content).toBe('hello world');
      expect(result!.size).toBe(11);
    });

    it('should return null for non-existing file', async () => {
      const workDir = await service.getWorkDir('conv-read');
      const result = await service.readFile('missing.txt', workDir);
      expect(result).toBeNull();
    });

    it('should throw for file exceeding 1MB', async () => {
      const workDir = await service.getWorkDir('conv-read');
      const bigContent = 'x'.repeat(1024 * 1024 + 1);
      await fs.writeFile(path.join(workDir, 'big.txt'), bigContent);
      await expect(service.readFile('big.txt', workDir)).rejects.toThrow(
        'File too large',
      );
    });

    it('should read up to 1MB file', async () => {
      const workDir = await service.getWorkDir('conv-read');
      const content = 'x'.repeat(1024 * 1024);
      await fs.writeFile(path.join(workDir, 'max.txt'), content);
      const result = await service.readFile('max.txt', workDir);
      expect(result).not.toBeNull();
      expect(result!.content.length).toBe(1024 * 1024);
    });
  });

  describe('writeFile', () => {
    it('should create new file with content', async () => {
      const workDir = await service.getWorkDir('conv-write');
      const result = await service.writeFile('new.txt', 'content', workDir);
      expect(result.size).toBe(7);
      const actual = await fs.readFile(path.join(workDir, 'new.txt'), 'utf-8');
      expect(actual).toBe('content');
    });

    it('should create intermediate directories', async () => {
      const workDir = await service.getWorkDir('conv-write');
      await service.writeFile('a/b/deep.txt', 'deep', workDir);
      const actual = await fs.readFile(
        path.join(workDir, 'a/b/deep.txt'),
        'utf-8',
      );
      expect(actual).toBe('deep');
    });

    it('should throw if file already exists', async () => {
      const workDir = await service.getWorkDir('conv-write');
      await fs.writeFile(path.join(workDir, 'exist.txt'), 'old');
      await expect(
        service.writeFile('exist.txt', 'new', workDir),
      ).rejects.toThrow('File already exists');
    });
  });

  describe('editFile', () => {
    it('should replace first occurrence', async () => {
      const workDir = await service.getWorkDir('conv-edit');
      await fs.writeFile(path.join(workDir, 'edit.txt'), 'aaa bbb aaa');
      const result = await service.editFile('edit.txt', 'aaa', 'ccc', workDir);
      expect(result.changes).toBe(1);
      const actual = await fs.readFile(path.join(workDir, 'edit.txt'), 'utf-8');
      expect(actual).toBe('ccc bbb aaa');
    });

    it('should throw if file not found', async () => {
      const workDir = await service.getWorkDir('conv-edit');
      await expect(
        service.editFile('missing.txt', 'a', 'b', workDir),
      ).rejects.toThrow('File not found');
    });

    it('should throw if old_string not found', async () => {
      const workDir = await service.getWorkDir('conv-edit');
      await fs.writeFile(path.join(workDir, 'edit.txt'), 'hello');
      await expect(
        service.editFile('edit.txt', 'xyz', 'abc', workDir),
      ).rejects.toThrow('old_string not found');
    });
  });

  describe('path validation', () => {
    it('should reject path traversal with ..', async () => {
      const workDir = await service.getWorkDir('conv-safe');
      await expect(
        service.readFile('../../../etc/passwd', workDir),
      ).rejects.toThrow('Invalid filename');
    });

    it('should reject absolute paths', async () => {
      const workDir = await service.getWorkDir('conv-safe');
      await expect(service.readFile('/etc/passwd', workDir)).rejects.toThrow(
        'Invalid filename',
      );
    });

    it('should reject URL-encoded traversal', async () => {
      const workDir = await service.getWorkDir('conv-safe');
      await expect(
        service.readFile('%2e%2e%2fetc%2fpasswd', workDir),
      ).rejects.toThrow('Invalid filename');
    });

    it('should reject null bytes', async () => {
      const workDir = await service.getWorkDir('conv-safe');
      await expect(service.readFile('file\x00name', workDir)).rejects.toThrow(
        'Invalid filename',
      );
    });

    it('should reject backslashes', async () => {
      const workDir = await service.getWorkDir('conv-safe');
      await expect(
        service.readFile('..\\etc\\passwd', workDir),
      ).rejects.toThrow('Invalid filename');
    });
  });
});
