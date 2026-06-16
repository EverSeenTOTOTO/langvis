import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { container } from 'tsyringe';
import {
  CacheService,
  STRING_THRESHOLD,
  PREVIEW_LENGTH,
  isCachedReference,
  type CachedReference,
} from '@/server/modules/memory/application/cache.service';
import { WorkspaceService } from '@/server/libs/infrastructure/workspace.service';

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
  const conversationId = 'conv-test-123';

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
    describe('string', () => {
      it(`should compress string longer than STRING_THRESHOLD chars`, async () => {
        const longString = 'a'.repeat(STRING_THRESHOLD + 1);

        const result = (await cacheService.compress(
          conversationId,
          longString,
        )) as CachedReference;

        expect(isCachedReference(result)).toBe(true);
        expect(result.$cached).toMatch(/^fc_/);
        expect(result.$size).toBe(STRING_THRESHOLD + 1);
        expect(result.$preview).toBe('a'.repeat(PREVIEW_LENGTH));
      });

      it(`should not compress string shorter than STRING_THRESHOLD chars`, async () => {
        const shortString = 'a'.repeat(100);

        const result = await cacheService.compress(conversationId, shortString);

        expect(result).toBe(shortString);
      });
    });

    describe('array — dynamic threshold', () => {
      it('should preserve array structure for chunks-like data (30 items)', async () => {
        const chunks = Array.from({ length: 30 }, (_, i) => ({
          content: `chunk-${i}-`.repeat(100),
          index: i,
        }));

        const result = (await cacheService.compress(
          conversationId,
          chunks,
        )) as unknown[];

        expect(Array.isArray(result)).toBe(true);
        expect(result.length).toBe(30);
        expect(isCachedReference((result[0] as any).content)).toBe(true);
        expect((result[0] as any).index).toBe(0);
      });

      it('should keep content inline when array is small (5 items)', async () => {
        const items = Array.from({ length: 5 }, (_, i) => ({
          content: 'x'.repeat(2000),
          index: i,
        }));

        const result = (await cacheService.compress(
          conversationId,
          items,
        )) as unknown[];

        expect(Array.isArray(result)).toBe(true);
        expect((result[0] as any).content).toBe(items[0].content);
        expect((result[0] as any).index).toBe(0);
      });

      it('should compress uniform large strings within array', async () => {
        const items = Array.from({ length: 30 }, (_, i) =>
          `item-${i}-`.repeat(200),
        );

        const result = (await cacheService.compress(
          conversationId,
          items,
        )) as unknown[];

        expect(Array.isArray(result)).toBe(true);
        expect(result.length).toBe(30);
        expect(isCachedReference(result[0])).toBe(true);
      });

      it('should whole-compress when compressed structure still exceeds STRING_THRESHOLD', async () => {
        const items = Array.from({ length: 150 }, (_, i) => ({
          content: 'x'.repeat(500),
          index: i,
        }));

        const result = await cacheService.compress(conversationId, items);

        expect(isCachedReference(result)).toBe(true);
      });

      it('should keep short strings inline in mixed array', async () => {
        const items = Array.from({ length: 20 }, (_, i) => ({
          label: `item-${i}`,
          content: i % 2 === 0 ? 'short content' : 'x'.repeat(2000),
        }));

        const result = (await cacheService.compress(
          conversationId,
          items,
        )) as unknown[];

        expect((result[0] as any).content).toBe('short content');
        expect(isCachedReference((result[1] as any).content)).toBe(true);
      });

      it('should not compress small array', async () => {
        const arr = ['short1', 'short2', 'short3'];

        const result = await cacheService.compress(conversationId, arr);

        expect(result).toEqual(arr);
      });
    });

    describe('object — dynamic threshold', () => {
      it('should preserve object structure with compressed large field', async () => {
        const obj = {
          short: 'hi',
          long: 'a'.repeat(STRING_THRESHOLD + 1),
        };

        const result = (await cacheService.compress(
          conversationId,
          obj,
        )) as Record<string, unknown>;

        expect(result.short).toBe('hi');
        expect(isCachedReference(result.long)).toBe(true);
      });

      it('should compress fields based on field count in large object', async () => {
        const obj: Record<string, string> = {};
        for (let i = 0; i < 10; i++) {
          obj[`field${i}`] = 'x'.repeat(5000);
        }

        const result = (await cacheService.compress(
          conversationId,
          obj,
        )) as Record<string, unknown>;

        for (let i = 0; i < 10; i++) {
          expect(isCachedReference(result[`field${i}`])).toBe(true);
        }
      });

      it('should keep moderate fields inline in small object', async () => {
        const obj = {
          title: 'x'.repeat(2000),
          summary: 'y'.repeat(2000),
        };

        const result = (await cacheService.compress(
          conversationId,
          obj,
        )) as Record<string, unknown>;

        // 2 fields → threshold = STRING_THRESHOLD / 2 = 10000 → 2000 < 10000 inline
        expect(result.title).toBe(obj.title);
        expect(result.summary).toBe(obj.summary);
      });

      it('should not compress small object', async () => {
        const obj = { name: 'test', count: 42 };

        const result = await cacheService.compress(conversationId, obj);

        expect(result).toEqual(obj);
      });
    });

    describe('nested structure — threshold propagation', () => {
      it('should propagate threshold through object → array → object', async () => {
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

        expect(result.title).toBe('Test Doc');
        expect(Array.isArray(result.chunks)).toBe(true);
        expect((result.chunks as unknown[]).length).toBe(25);
        const firstChunk = (result.chunks as unknown[])[0] as Record<
          string,
          unknown
        >;
        expect(isCachedReference(firstChunk.content)).toBe(true);
        expect(firstChunk.index).toBe(0);
      });

      it('should respect MIN_ITEM_THRESHOLD floor — protect moderately-short strings', async () => {
        // 80 items — STRING_THRESHOLD/80 = 250, floor → MIN_ITEM_THRESHOLD (~310)
        // 280-char strings: >250 (would compress without floor) but <310 (protected by floor)
        const items = Array.from({ length: 80 }, (_, i) => ({
          label: `item-${i}`,
          content: i < 40 ? 'x'.repeat(280) : 'y'.repeat(1000),
        }));

        const result = (await cacheService.compress(
          conversationId,
          items,
        )) as unknown[];

        // 280-char strings stay inline (protected by MIN_ITEM_THRESHOLD floor)
        expect((result[0] as any).content).toBe('x'.repeat(280));
        // 1000-char strings compressed (> MIN_ITEM_THRESHOLD)
        expect(isCachedReference((result[40] as any).content)).toBe(true);
        expect((result[0] as any).label).toBe('item-0');
      });
    });

    describe('skip strategy', () => {
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
  });

  describe('resolve', () => {
    const resolveId = 'conv-test-456';

    it('should resolve CachedReference by reading file', async () => {
      const longString = 'a'.repeat(STRING_THRESHOLD + 1);

      const compressed = (await cacheService.compress(
        resolveId,
        longString,
      )) as CachedReference;
      const result = await cacheService.resolve(resolveId, compressed);

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

      const result = await cacheService.resolve(resolveId, {
        $cached: filename,
      });

      expect(result).toEqual(jsonObject);
    });

    it('should resolve CachedReference in array context', async () => {
      const content = 'a'.repeat(STRING_THRESHOLD + 1);
      const ref = (await cacheService.compress(resolveId, content)) as {
        $cached: string;
      };

      const input = { items: [ref] };
      const result = (await cacheService.resolve(resolveId, input)) as Record<
        string,
        unknown
      >;

      expect((result.items as unknown[])[0]).toBe(content);
    });

    it('should resolve $cached property in object back to string', async () => {
      const obj = {
        content: 'a'.repeat(STRING_THRESHOLD + 1),
        url: 'https://example.com',
        status: 200,
      };

      const compressed = (await cacheService.compress(
        resolveId,
        obj,
      )) as Record<string, unknown>;
      const resolved = (await cacheService.resolve(
        resolveId,
        compressed,
      )) as Record<string, unknown>;

      expect(typeof resolved.content).toBe('string');
      expect(resolved.content).toBe(obj.content);
      expect(resolved.url).toBe(obj.url);
      expect(resolved.status).toBe(200);
    });

    it('should not modify non-CachedReference objects', async () => {
      const input = { name: 'test', count: 42, flag: true };

      const result = await cacheService.resolve(resolveId, input);

      expect(result).toEqual(input);
    });

    it('should throw error when cache miss', async () => {
      await expect(
        cacheService.resolve(resolveId, {
          $cached: 'fc_nonexistent',
          $size: 100,
        }),
      ).rejects.toThrow('Cache miss: fc_nonexistent');
    });

    it('should roundtrip compress-resolve for string', async () => {
      const value = 'x'.repeat(STRING_THRESHOLD + 500);
      const compressed = await cacheService.compress(resolveId, value);
      const resolved = await cacheService.resolve(resolveId, compressed);
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
      const compressed = await cacheService.compress(resolveId, value);
      const resolved = await cacheService.resolve(resolveId, compressed);
      expect(resolved).toEqual(value);
    });

    it('should roundtrip compress-resolve for array', async () => {
      const value = Array.from({ length: 30 }, (_, i) =>
        `item-${i}-`.repeat(200),
      );
      const compressed = await cacheService.compress(resolveId, value);
      const resolved = await cacheService.resolve(resolveId, compressed);
      expect(resolved).toEqual(value);
    });

    it('should roundtrip for whole-compressed array', async () => {
      const value = Array.from({ length: 150 }, (_, i) => ({
        content: 'x'.repeat(500),
        index: i,
      }));
      const compressed = await cacheService.compress(resolveId, value);
      const resolved = await cacheService.resolve(resolveId, compressed);
      expect(resolved).toEqual(value);
    });
  });

  describe('readFile', () => {
    const readId = 'conv-test-789';

    it('should read file with offset and limit', async () => {
      const content = '0123456789abcdef';
      const workDir = await mockWorkspaceService.getWorkDir();
      await fs.writeFile(path.join(workDir, 'fc_test'), content, 'utf-8');

      const result = await cacheService.readFile(readId, 'fc_test', 4, 8);
      expect(result).toBe('456789ab');
    });

    it('should read file from beginning when offset is omitted', async () => {
      const content = 'hello world';
      const workDir = await mockWorkspaceService.getWorkDir();
      await fs.writeFile(path.join(workDir, 'fc_test2'), content, 'utf-8');

      const result = await cacheService.readFile(
        readId,
        'fc_test2',
        undefined,
        5,
      );
      expect(result).toBe('hello');
    });

    it('should throw error when file not found', async () => {
      await expect(cacheService.readFile(readId, 'fc_missing')).rejects.toThrow(
        'Cache miss: fc_missing',
      );
    });
  });
});
