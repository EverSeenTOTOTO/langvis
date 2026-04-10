import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { describe, it, expect, beforeEach, vi, afterAll } from 'vitest';
import { container } from 'tsyringe';
import { compress, resolve, STRING_THRESHOLD } from '@/server/utils/cache';
import { RedisKeys } from '@/shared/constants';
import { RedisService } from '@/server/service/RedisService';
import { WorkspaceService } from '@/server/service/WorkspaceService';

let testDir: string;

const mockWorkspaceService = {
  getWorkDir: vi.fn().mockImplementation(async () => {
    if (!testDir) {
      testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cache-test-'));
    }
    return testDir;
  }),
};

describe('Cache Utils', () => {
  let mockRedisService: {
    client: {
      setEx: ReturnType<typeof vi.fn>;
      get: ReturnType<typeof vi.fn>;
    };
  };

  afterAll(async () => {
    if (testDir) {
      await fs.rm(testDir, { recursive: true, force: true });
    }
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockRedisService = {
      client: {
        setEx: vi.fn().mockResolvedValue('OK'),
        get: vi.fn().mockResolvedValue(null),
      },
    };

    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    container.register(RedisService, { useValue: mockRedisService });
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    container.register(WorkspaceService, { useValue: mockWorkspaceService });
  });

  describe('compress', () => {
    const traceId = 'test-trace-id';

    it(`should compress string longer than ${STRING_THRESHOLD} chars`, async () => {
      const longString = 'a'.repeat(STRING_THRESHOLD + 1);

      const result = (await compress(traceId, longString)) as {
        $cached: string;
        $size: number;
        $preview: string;
      };

      expect(result.$cached).toMatch(/^cache_/);
      expect(result.$size).toBe(STRING_THRESHOLD + 1);
      expect(result.$preview).toBe('a'.repeat(200));
      expect(mockRedisService.client.setEx).toHaveBeenCalledWith(
        expect.stringContaining(RedisKeys.AGENT_CACHE(traceId, result.$cached)),
        3600,
        longString,
      );
    });

    it(`should not compress string shorter than ${STRING_THRESHOLD} chars`, async () => {
      const shortString = 'a'.repeat(100);

      const result = await compress(traceId, shortString);

      expect(result).toBe(shortString);
    });

    it('should compress array with more than 50 items', async () => {
      const largeArray = Array.from({ length: 51 }, (_, i) => ({ id: i }));

      const result = (await compress(traceId, largeArray)) as {
        $cached: string;
      };

      expect(result.$cached).toMatch(/^cache_/);
      expect(mockRedisService.client.setEx).toHaveBeenCalled();
    });

    it('should not compress array with 50 or fewer items', async () => {
      const smallArray = Array.from({ length: 50 }, (_, i) => `item-${i}`);

      const result = await compress(traceId, smallArray);

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

      const result = (await compress(traceId, nested)) as Record<
        string,
        unknown
      >;

      expect(result.short).toBe('short string');
      expect((result.long as { $cached: string }).$cached).toMatch(/^cache_/);
      expect(
        ((result.nested as Record<string, unknown>).deep as { $cached: string })
          .$cached,
      ).toMatch(/^cache_/);
    });

    it('should recursively compress array items', async () => {
      const nested = {
        items: [
          'a'.repeat(STRING_THRESHOLD + 1),
          'short',
          'b'.repeat(STRING_THRESHOLD + 1),
        ],
      };

      const result = (await compress(traceId, nested)) as Record<
        string,
        unknown
      >;
      const items = result.items as unknown[];

      expect((items[0] as { $cached: string }).$cached).toMatch(/^cache_/);
      expect(items[1]).toBe('short');
      expect((items[2] as { $cached: string }).$cached).toMatch(/^cache_/);
    });

    it('should skip compression when strategy is "skip"', async () => {
      const longString = 'a'.repeat(STRING_THRESHOLD + 1);
      const result = await compress(traceId, longString, 'skip');
      expect(result).toBe(longString);
      expect(mockRedisService.client.setEx).not.toHaveBeenCalled();
    });

    it('should skip compression recursively when strategy is "skip"', async () => {
      const nested = {
        long: 'a'.repeat(STRING_THRESHOLD + 1),
        items: ['b'.repeat(5001)],
      };
      const result = await compress(traceId, nested, 'skip');
      expect(result).toEqual(nested);
      expect(mockRedisService.client.setEx).not.toHaveBeenCalled();
    });

    it('should compress to file when strategy is "file"', async () => {
      const longString = 'a'.repeat(STRING_THRESHOLD + 1);
      const result = (await compress(
        traceId,
        longString,
        'file',
        'conv-123',
      )) as {
        $file: string;
        $size: number;
        $preview: string;
      };

      expect(result.$file).toMatch(/^fc_/);
      expect(result.$size).toBe(STRING_THRESHOLD + 1);
      expect(result.$preview).toBe('a'.repeat(200));
      expect(mockWorkspaceService.getWorkDir).toHaveBeenCalledWith('conv-123');
      expect(mockRedisService.client.setEx).not.toHaveBeenCalled();
    });

    it('should throw when file strategy is used without conversationId', async () => {
      await expect(
        compress(traceId, 'a'.repeat(STRING_THRESHOLD + 1), 'file'),
      ).rejects.toThrow('conversationId is required');
    });

    it('should not compress small values even with file strategy', async () => {
      const shortString = 'hello';
      const result = await compress(traceId, shortString, 'file', 'conv-123');
      expect(result).toBe(shortString);
    });

    it('should use redis strategy by default', async () => {
      const longString = 'a'.repeat(STRING_THRESHOLD + 1);
      const result = (await compress(traceId, longString)) as {
        $cached: string;
      };
      expect(result.$cached).toMatch(/^cache_/);
      expect(mockRedisService.client.setEx).toHaveBeenCalled();
    });
  });

  describe('resolve', () => {
    const traceId = 'test-trace-id';

    it('should resolve CachedReference', async () => {
      mockRedisService.client.get.mockResolvedValueOnce('resolved content');

      const input = {
        $cached: 'cache_abc123',
        $size: 100,
      };

      const result = await resolve(traceId, input);

      expect(result).toBe('resolved content');
      expect(mockRedisService.client.get).toHaveBeenCalledWith(
        RedisKeys.AGENT_CACHE(traceId, 'cache_abc123'),
      );
    });

    it('should recursively resolve nested CachedReferences', async () => {
      mockRedisService.client.get
        .mockResolvedValueOnce('content1')
        .mockResolvedValueOnce('content2');

      const input = {
        nested: {
          ref1: { $cached: 'cache_1', $size: 100 },
          ref2: { $cached: 'cache_2', $size: 200 },
        },
      };

      const result = (await resolve(traceId, input)) as Record<string, unknown>;
      const nested = result.nested as Record<string, unknown>;

      expect(nested.ref1).toBe('content1');
      expect(nested.ref2).toBe('content2');
    });

    it('should resolve CachedReference in array', async () => {
      mockRedisService.client.get.mockResolvedValueOnce('array content');

      const input = {
        items: [{ $cached: 'cache_arr', $size: 50 }],
      };

      const result = (await resolve(traceId, input)) as Record<string, unknown>;

      expect((result.items as unknown[])[0]).toBe('array content');
    });

    it('should not modify non-CachedReference objects', async () => {
      const input = {
        name: 'test',
        count: 42,
        flag: true,
      };

      const result = await resolve(traceId, input);

      expect(result).toEqual(input);
    });

    it('should throw error when cache miss', async () => {
      mockRedisService.client.get.mockResolvedValueOnce(null);

      const input = { $cached: 'cache_notexist', $size: 100 };

      await expect(resolve(traceId, input)).rejects.toThrow(
        'Cache miss: cache_notexist',
      );
    });

    it('should parse JSON from cache', async () => {
      mockRedisService.client.get.mockResolvedValueOnce('{"key":"value"}');

      const input = { $cached: 'cache_json', $size: 100 };

      const result = await resolve(traceId, input);

      expect(result).toEqual({ key: 'value' });
    });
  });
});
