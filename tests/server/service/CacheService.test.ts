import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { container } from 'tsyringe';
import {
  CacheService,
  STRING_THRESHOLD,
  isCachedReference,
} from '@/server/service/CacheService';
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

    it(`should compress string longer than ${STRING_THRESHOLD} chars`, async () => {
      const longString = 'a'.repeat(STRING_THRESHOLD + 1);

      const result = (await cacheService.compress(
        conversationId,
        longString,
      )) as { $cached: string; $size: number; $preview: string };

      expect(result.$cached).toMatch(/^fc_/);
      expect(result.$size).toBe(STRING_THRESHOLD + 1);
      expect(result.$preview).toBe('a'.repeat(200));

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

    it('should compress array whose stringify exceeds threshold', async () => {
      const items = Array.from({ length: 30 }, (_, i) =>
        `item-${i}-`.repeat(200),
      );

      const result = (await cacheService.compress(conversationId, items)) as {
        $cached: string;
      };

      expect(result.$cached).toMatch(/^fc_/);

      const resolved = (await cacheService.resolve(
        conversationId,
        result,
      )) as unknown[];
      expect(resolved.length).toBe(30);
      for (let i = 0; i < 30; i++) {
        expect(resolved[i]).toBe(items[i]);
      }
    });

    it('should not compress small array', async () => {
      const arr = ['short1', 'short2', 'short3'];

      const result = await cacheService.compress(conversationId, arr);

      expect(result).toEqual(arr);
    });

    it('should recursively compress object — keep structure, compress individual strings', async () => {
      const obj = {
        short: 'hi',
        long: 'a'.repeat(STRING_THRESHOLD + 1),
        nested: {
          deep: 'b'.repeat(STRING_THRESHOLD + 1),
        },
      };

      const result = (await cacheService.compress(
        conversationId,
        obj,
      )) as Record<string, unknown>;

      // Structure preserved — short stays inline, long gets $cached
      expect(result.short).toBe('hi');
      expect(isCachedReference(result.long)).toBe(true);
      expect(
        isCachedReference((result.nested as Record<string, unknown>).deep),
      ).toBe(true);

      // Resolve restores original
      const resolved = (await cacheService.resolve(
        conversationId,
        result,
      )) as Record<string, unknown>;
      expect(resolved.short).toBe('hi');
      expect(resolved.long).toBe('a'.repeat(STRING_THRESHOLD + 1));
      expect((resolved.nested as Record<string, unknown>).deep).toBe(
        'b'.repeat(STRING_THRESHOLD + 1),
      );
    });

    it('should compress nested array inside object as whole', async () => {
      const obj = {
        title: 'Test Doc',
        chunks: Array.from({ length: 25 }, (_, i) => ({
          content: `chunk-${i}-`.repeat(200),
          index: i,
        })),
      };

      const result = (await cacheService.compress(
        conversationId,
        obj,
      )) as Record<string, unknown>;

      // title stays inline, chunks (array) gets whole-compressed
      expect(result.title).toBe('Test Doc');
      expect(isCachedReference(result.chunks)).toBe(true);

      const resolved = (await cacheService.resolve(
        conversationId,
        result,
      )) as Record<string, unknown>;
      expect(resolved.title).toBe('Test Doc');
      const resolvedChunks = resolved.chunks as Array<{
        content: string;
        index: number;
      }>;
      expect(resolvedChunks.length).toBe(25);
      for (let i = 0; i < 25; i++) {
        expect(resolvedChunks[i].content).toBe(obj.chunks[i].content);
        expect(resolvedChunks[i].index).toBe(i);
      }
    });

    it('should not compress small object', async () => {
      const obj = { name: 'test', count: 42 };

      const result = await cacheService.compress(conversationId, obj);

      expect(result).toEqual(obj);
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

      const compressed = (await cacheService.compress(
        conversationId,
        longString,
      )) as { $cached: string };
      const result = await cacheService.resolve(conversationId, compressed);

      expect(result).toBe(longString);
    });

    it('should resolve CachedReference containing JSON object', async () => {
      const jsonObject = { key: 'value', count: 42 };

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

    it('should resolve CachedReference in array context', async () => {
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

    it('should resolve $cached property in object back to string', async () => {
      // Key pass-through scenario: LLM passes { content: { $cached } } to next tool
      const obj = {
        content: 'a'.repeat(STRING_THRESHOLD + 1),
        url: 'https://example.com',
        status: 200,
      };

      const compressed = (await cacheService.compress(
        conversationId,
        obj,
      )) as Record<string, unknown>;
      const resolved = (await cacheService.resolve(
        conversationId,
        compressed,
      )) as Record<string, unknown>;

      // content resolves back to string (not object)
      expect(typeof resolved.content).toBe('string');
      expect(resolved.content).toBe(obj.content);
      expect(resolved.url).toBe(obj.url);
      expect(resolved.status).toBe(200);
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

    it('should roundtrip compress-resolve for string', async () => {
      const value = 'x'.repeat(STRING_THRESHOLD + 500);
      const compressed = await cacheService.compress(conversationId, value);
      const resolved = await cacheService.resolve(conversationId, compressed);
      expect(resolved).toBe(value);
    });

    it('should roundtrip compress-resolve for object with nested array', async () => {
      const value = {
        title: 'Test Doc',
        chunks: Array.from({ length: 25 }, (_, i) => ({
          content: `chunk-${i}-`.repeat(200),
          index: i,
        })),
      };
      const compressed = await cacheService.compress(conversationId, value);
      const resolved = await cacheService.resolve(conversationId, compressed);
      expect(resolved).toEqual(value);
    });

    it('should roundtrip compress-resolve for array', async () => {
      const value = Array.from({ length: 20 }, (_, i) =>
        `item-${i}-`.repeat(200),
      );
      const compressed = await cacheService.compress(conversationId, value);
      const resolved = await cacheService.resolve(conversationId, compressed);
      expect(resolved).toEqual(value);
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
