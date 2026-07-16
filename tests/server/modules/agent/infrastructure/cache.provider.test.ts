import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { container } from 'tsyringe';
import {
  CacheProvider,
  PREVIEW_LENGTH,
} from '@/server/modules/agent/infrastructure/cache.provider';
import {
  isCachedReference,
  type CachedReference,
} from '@/server/modules/agent/domain/port/cache.port';
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

describe('CacheProvider', () => {
  let cacheService: CacheProvider;
  let workDir: string;

  afterAll(async () => {
    if (testDir) {
      await fs.rm(testDir, { recursive: true, force: true });
    }
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    container.register(WorkspaceService, { useValue: mockWorkspaceService });
    cacheService = container.resolve(CacheProvider);
    workDir = await mockWorkspaceService.getWorkDir();
  });

  describe('resolve', () => {
    it('should resolve CachedReference by reading file', async () => {
      const longString = 'a'.repeat(500);

      const ref = await cacheService.offload(workDir, longString);
      const result = await cacheService.resolve(workDir, ref);

      expect(result).toBe(longString);
    });

    it('should resolve CachedReference containing JSON object', async () => {
      const jsonObject = { key: 'value', count: 42 };

      const filename = 'fc_testjson';
      await fs.writeFile(
        path.join(workDir, filename),
        JSON.stringify(jsonObject),
        'utf-8',
      );

      const result = await cacheService.resolve(workDir, {
        $cached: filename,
      });

      expect(result).toEqual(jsonObject);
    });

    it('should resolve CachedReference in array context', async () => {
      const content = 'a'.repeat(500);
      const ref = await cacheService.offload(workDir, content);

      const input = { items: [ref] };
      const result = (await cacheService.resolve(workDir, input)) as Record<
        string,
        unknown
      >;

      expect((result.items as unknown[])[0]).toBe(content);
    });

    it('should resolve $cached property in object back to original value', async () => {
      const value = {
        content: 'x'.repeat(500),
        url: 'https://example.com',
        status: 200,
      };

      const offloaded = await cacheService.offload(workDir, value);
      const resolved = (await cacheService.resolve(
        workDir,
        offloaded,
      )) as Record<string, unknown>;

      expect(resolved).toEqual(value);
    });

    it('should not modify non-CachedReference objects', async () => {
      const input = { name: 'test', count: 42, flag: true };

      const result = await cacheService.resolve(workDir, input);

      expect(result).toEqual(input);
    });

    it('should throw error when cache miss', async () => {
      await expect(
        cacheService.resolve(workDir, {
          $cached: 'fc_nonexistent',
          $size: 100,
        }),
      ).rejects.toThrow('Cache miss: fc_nonexistent');
    });

    it('should roundtrip offload-resolve for string', async () => {
      const value = 'x'.repeat(500);
      const ref = await cacheService.offload(workDir, value);
      const resolved = await cacheService.resolve(workDir, ref);
      expect(resolved).toBe(value);
    });

    it('should roundtrip offload-resolve for object', async () => {
      const value = {
        title: 'Test Doc',
        chunks: Array.from({ length: 25 }, (_, i) => ({
          content: `chunk-${i}-`.repeat(200),
          index: i,
        })),
      };
      const ref = await cacheService.offload(workDir, value);
      const resolved = await cacheService.resolve(workDir, ref);
      expect(resolved).toEqual(value);
    });
  });

  describe('readFile', () => {
    it('should read file with offset and limit', async () => {
      const content = '0123456789abcdef';
      await fs.writeFile(path.join(workDir, 'fc_test'), content, 'utf-8');

      const result = await cacheService.readFile(workDir, 'fc_test', 4, 8);
      expect(result).toBe('456789ab');
    });

    it('should read file from beginning when offset is omitted', async () => {
      const content = 'hello world';
      await fs.writeFile(path.join(workDir, 'fc_test2'), content, 'utf-8');

      const result = await cacheService.readFile(
        workDir,
        'fc_test2',
        undefined,
        5,
      );
      expect(result).toBe('hello');
    });

    it('should throw error when file not found', async () => {
      await expect(
        cacheService.readFile(workDir, 'fc_missing'),
      ).rejects.toThrow('Cache miss: fc_missing');
    });
  });

  describe('offload', () => {
    it('always writes to disk and returns a CachedReference (even for small content)', async () => {
      const result = await cacheService.offload(workDir, 'tiny');

      expect(isCachedReference(result)).toBe(true);
      expect(result.$cached).toMatch(/^fc_/);
      expect(result.$size).toBe(4);
      expect(result.$preview).toBe('tiny');
      // offload 始终写盘，小内容也落文件
      const reread = await cacheService.readFile(workDir, result.$cached);
      expect(reread).toBe('tiny');
    });

    it('truncates $preview to PREVIEW_LENGTH for long content', async () => {
      const long = 'a'.repeat(PREVIEW_LENGTH + 50);
      const result = await cacheService.offload(workDir, long);
      expect(result.$preview).toBe('a'.repeat(PREVIEW_LENGTH));
    });

    it('uses semantic filename + $label when hint given', async () => {
      const result = (await cacheService.offload(
        workDir,
        'x'.repeat(500),
        'search-flights 京→沪, 40 records',
      )) as CachedReference;

      // hint 规整为文件名安全段，前置语义 + '__' + fc_<id>
      expect(result.$cached).toMatch(/^search-flights-40-records__fc_/);
      expect(result.$label).toBe('search-flights-40-records');
      expect(result.$size).toBe(500);
    });

    it('falls back to fc_<id> when hint absent or empty', async () => {
      const noHint = await cacheService.offload(workDir, 'data');
      expect(noHint.$cached).toMatch(/^fc_/);
      expect(noHint.$label).toBeUndefined();

      const emptyHint = await cacheService.offload(workDir, 'data', '   ');
      expect(emptyHint.$cached).toMatch(/^fc_/);
      expect(emptyHint.$label).toBeUndefined();
    });

    it('offloads non-string value by JSON-stringifying', async () => {
      const obj = { flights: [{ id: 'f1' }, { id: 'f2' }] };
      const result = await cacheService.offload(workDir, obj, 'search-flights');
      const reread = (await cacheService.readFile(
        workDir,
        result.$cached,
      )) as Record<string, unknown>;
      expect(reread).toEqual(obj);
    });
  });
});
