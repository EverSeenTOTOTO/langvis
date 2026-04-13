import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { container } from 'tsyringe';
import { CacheService, STRING_THRESHOLD } from '@/server/service/CacheService';
import { WorkspaceService } from '@/server/service/WorkspaceService';

let testDir: string;

const mockWorkspaceService = {
  getWorkDir: vi.fn().mockImplementation(async () => {
    if (!testDir) {
      testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cache-test-'));
    }
    return testDir;
  }),
  readFile: vi
    .fn()
    .mockImplementation(async (filename: string, workDir: string) => {
      const filePath = path.join(workDir, filename);
      const stat = await fs.stat(filePath).catch(() => null);
      if (!stat) return null;
      const content = await fs.readFile(filePath, 'utf-8');
      return { content, size: stat.size };
    }),
};

describe('CacheService', () => {
  let cacheService: CacheService;

  afterAll(async () => {
    if (testDir) {
      await fs.rm(testDir, { recursive: true, force: true });
    }
  });

  beforeEach(() => {
    vi.clearAllMocks();
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    container.register(WorkspaceService, { useValue: mockWorkspaceService });
    cacheService = container.resolve(CacheService);
  });

  describe('compress', () => {
    const conversationId = 'conv-test-123';

    it(`should compress string longer than ${STRING_THRESHOLD} chars to file`, async () => {
      const longString = 'a'.repeat(STRING_THRESHOLD + 1);

      const result = (await cacheService.compress(
        conversationId,
        longString,
      )) as {
        $cached: string;
        $size: number;
        $preview: string;
      };

      expect(result.$cached).toMatch(/^fc_/);
      expect(result.$size).toBe(STRING_THRESHOLD + 1);
      expect(result.$preview).toBe('a'.repeat(200));
      expect(mockWorkspaceService.getWorkDir).toHaveBeenCalledWith(
        conversationId,
      );

      // Verify file was actually written
      const workDir = await mockWorkspaceService.getWorkDir();
      const fileResult = await mockWorkspaceService.readFile(
        result.$cached,
        workDir,
      );
      expect(fileResult?.content).toBe(longString);
    });

    it(`should not compress string shorter than ${STRING_THRESHOLD} chars`, async () => {
      const shortString = 'a'.repeat(100);

      const result = await cacheService.compress(conversationId, shortString);

      expect(result).toBe(shortString);
    });

    it('should compress array with more than 50 items', async () => {
      const largeArray = Array.from({ length: 51 }, (_, i) => ({ id: i }));

      const result = (await cacheService.compress(
        conversationId,
        largeArray,
      )) as {
        $cached: string;
      };

      expect(result.$cached).toMatch(/^fc_/);
    });

    it('should not compress array with 50 or fewer items', async () => {
      const smallArray = Array.from({ length: 50 }, (_, i) => `item-${i}`);

      const result = await cacheService.compress(conversationId, smallArray);

      expect(result).toEqual(smallArray);
    });

    it('should recursively compress nested values while preserving first-level keys', async () => {
      const nested = {
        short: 'short string',
        long: 'a'.repeat(STRING_THRESHOLD + 1),
        nested: {
          deep: 'b'.repeat(STRING_THRESHOLD + 1),
        },
      };

      const result = (await cacheService.compress(
        conversationId,
        nested,
      )) as Record<string, unknown>;

      expect(result.short).toBe('short string');
      expect((result.long as { $cached: string }).$cached).toMatch(/^fc_/);
      expect(
        ((result.nested as Record<string, unknown>).deep as { $cached: string })
          .$cached,
      ).toMatch(/^fc_/);
    });

    it('should recursively compress array items', async () => {
      const nested = {
        items: [
          'a'.repeat(STRING_THRESHOLD + 1),
          'short',
          'b'.repeat(STRING_THRESHOLD + 1),
        ],
      };

      const result = (await cacheService.compress(
        conversationId,
        nested,
      )) as Record<string, unknown>;
      const items = result.items as unknown[];

      expect((items[0] as { $cached: string }).$cached).toMatch(/^fc_/);
      expect(items[1]).toBe('short');
      expect((items[2] as { $cached: string }).$cached).toMatch(/^fc_/);
    });

    it('should skip compression when strategy is "skip"', async () => {
      const longString = 'a'.repeat(STRING_THRESHOLD + 1);
      const result = await cacheService.compress(
        conversationId,
        longString,
        'skip',
      );
      expect(result).toBe(longString);
    });

    it('should skip compression recursively when strategy is "skip"', async () => {
      const nested = {
        long: 'a'.repeat(STRING_THRESHOLD + 1),
        items: ['b'.repeat(5001)],
      };
      const result = await cacheService.compress(
        conversationId,
        nested,
        'skip',
      );
      expect(result).toEqual(nested);
    });
  });

  describe('resolve', () => {
    const conversationId = 'conv-test-456';

    it('should resolve CachedReference by reading file', async () => {
      const longString = 'a'.repeat(STRING_THRESHOLD + 1);

      // First compress to create the file
      const compressed = (await cacheService.compress(
        conversationId,
        longString,
      )) as {
        $cached: string;
      };

      // Then resolve it
      const result = await cacheService.resolve(conversationId, compressed);

      expect(result).toBe(longString);
    });

    it('should resolve CachedReference containing JSON object', async () => {
      const jsonObject = { key: 'value', count: 42 };

      // Manually create a cache file with JSON content
      const workDir = await mockWorkspaceService.getWorkDir();
      const filename = 'fc_testjson';
      await fs.writeFile(
        path.join(workDir, filename),
        JSON.stringify(jsonObject),
        'utf-8',
      );

      const result = await cacheService.resolve(conversationId, {
        $cached: filename,
      });

      expect(result).toEqual(jsonObject);
    });

    it('should recursively resolve nested CachedReferences', async () => {
      const content1 = 'a'.repeat(STRING_THRESHOLD + 1);
      const content2 = 'b'.repeat(STRING_THRESHOLD + 1);

      const ref1 = (await cacheService.compress(conversationId, content1)) as {
        $cached: string;
      };
      const ref2 = (await cacheService.compress(conversationId, content2)) as {
        $cached: string;
      };

      const input = { nested: { ref1, ref2 } };
      const result = (await cacheService.resolve(
        conversationId,
        input,
      )) as Record<string, unknown>;
      const nested = result.nested as Record<string, unknown>;

      expect(nested.ref1).toBe(content1);
      expect(nested.ref2).toBe(content2);
    });

    it('should resolve CachedReference in array', async () => {
      const content = 'a'.repeat(STRING_THRESHOLD + 1);
      const ref = (await cacheService.compress(conversationId, content)) as {
        $cached: string;
      };

      const input = { items: [ref] };
      const result = (await cacheService.resolve(
        conversationId,
        input,
      )) as Record<string, unknown>;

      expect((result.items as unknown[])[0]).toBe(content);
    });

    it('should not modify non-CachedReference objects', async () => {
      const input = { name: 'test', count: 42, flag: true };

      const result = await cacheService.resolve(conversationId, input);

      expect(result).toEqual(input);
    });

    it('should throw error when cache miss', async () => {
      await expect(
        cacheService.resolve(conversationId, {
          $cached: 'fc_nonexistent',
          $size: 100,
        }),
      ).rejects.toThrow('Cache miss: fc_nonexistent');
    });
  });

  describe('readFile', () => {
    const conversationId = 'conv-test-789';

    it('should read file with offset and limit', async () => {
      const content = '0123456789abcdef';
      const workDir = await mockWorkspaceService.getWorkDir();
      await fs.writeFile(path.join(workDir, 'fc_test'), content, 'utf-8');

      const result = await cacheService.readFile(
        conversationId,
        'fc_test',
        4,
        8,
      );
      expect(result).toBe('456789ab');
    });

    it('should read file from beginning when offset is omitted', async () => {
      const content = 'hello world';
      const workDir = await mockWorkspaceService.getWorkDir();
      await fs.writeFile(path.join(workDir, 'fc_test2'), content, 'utf-8');

      const result = await cacheService.readFile(
        conversationId,
        'fc_test2',
        undefined,
        5,
      );
      expect(result).toBe('hello');
    });

    it('should throw error when file not found', async () => {
      await expect(
        cacheService.readFile(conversationId, 'fc_missing'),
      ).rejects.toThrow('Cache miss: fc_missing');
    });
  });
});
