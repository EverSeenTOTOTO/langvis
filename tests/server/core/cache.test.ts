import { describe, it, expect, beforeEach, vi } from 'vitest';
import { container } from 'tsyringe';
import { ExecutionContext } from '@/server/core/ExecutionContext';
import { InjectTokens, RedisKeys } from '@/shared/constants';

describe('ExecutionContext Cache Management', () => {
  let ctx: ExecutionContext;
  let mockRedis: {
    setEx: ReturnType<typeof vi.fn>;
    get: ReturnType<typeof vi.fn>;
    del: ReturnType<typeof vi.fn>;
  };
  let mockController: any;

  beforeEach(() => {
    mockRedis = {
      setEx: vi.fn().mockResolvedValue('OK'),
      get: vi.fn().mockResolvedValue(null),
      del: vi.fn().mockResolvedValue(1),
    };

    container.register(InjectTokens.REDIS, { useValue: mockRedis });

    mockController = {
      abort: vi.fn(),
      signal: { aborted: false, reason: null },
    };

    ctx = new ExecutionContext('test-trace-id', mockController);
  });

  describe('compress', () => {
    it('should compress a string and return CachedReference', async () => {
      const longString = 'a'.repeat(1500);

      const result = await ctx.compress(longString);

      expect(result).toMatchObject({
        $cached: expect.stringMatching(/^cache_/),
        $size: 1500,
        $preview: 'a'.repeat(200),
      });
      expect(mockRedis.setEx).toHaveBeenCalledWith(
        expect.stringContaining(RedisKeys.AGENT_CACHE('test-trace-id', '')),
        3600,
        longString,
      );
    });

    it('should compress an object and return CachedReference', async () => {
      const largeArray = Array.from({ length: 25 }, (_, i) => ({ id: i }));

      const result = await ctx.compress(largeArray);

      expect(result.$cached).toMatch(/^cache_/);
      expect(result.$size).toBeGreaterThan(0);
      expect(mockRedis.setEx).toHaveBeenCalledWith(
        expect.stringContaining(RedisKeys.AGENT_CACHE('test-trace-id', '')),
        3600,
        JSON.stringify(largeArray),
      );
    });

    it('should support custom preview length', async () => {
      const longString = 'a'.repeat(2000);

      const result = await ctx.compress(longString, { preview: 100 });

      expect(result.$preview).toBe('a'.repeat(100));
    });
  });

  describe('retrieve', () => {
    it('should retrieve cached string', async () => {
      mockRedis.get.mockResolvedValueOnce('cached content');

      const result = await ctx.retrieve('cache_abc123');

      expect(result).toBe('cached content');
      expect(mockRedis.get).toHaveBeenCalledWith(
        RedisKeys.AGENT_CACHE('test-trace-id', 'cache_abc123'),
      );
    });

    it('should throw error when cache miss', async () => {
      mockRedis.get.mockResolvedValueOnce(null);

      await expect(ctx.retrieve('cache_notexist')).rejects.toThrow(
        'Cache miss: cache_notexist',
      );
    });
  });

  describe('clearCache', () => {
    it('should delete all cached keys', async () => {
      // Compress some values to populate cachedKeys
      await ctx.compress('a'.repeat(1500));
      await ctx.compress('b'.repeat(1500));

      await ctx.clearCache();

      expect(mockRedis.del).toHaveBeenCalledTimes(1);
      expect(mockRedis.del).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.stringContaining(RedisKeys.AGENT_CACHE('test-trace-id', '')),
          expect.stringContaining(RedisKeys.AGENT_CACHE('test-trace-id', '')),
        ]),
      );
    });

    it('should do nothing when no cached keys', async () => {
      await ctx.clearCache();

      expect(mockRedis.del).not.toHaveBeenCalled();
    });
  });

  describe('shouldCompress', () => {
    it('should compress string longer than 1000 chars', async () => {
      const longString = 'a'.repeat(1001);
      const result = await ctx.autoCompressOutput(longString);

      expect(result).toHaveProperty('$cached');
    });

    it('should not compress string shorter than 1000 chars', async () => {
      const shortString = 'a'.repeat(999);
      const result = await ctx.autoCompressOutput(shortString);

      expect(result).toBe(shortString);
    });

    it('should compress array with more than 20 items', async () => {
      const largeArray = Array.from({ length: 21 }, (_, i) => `item-${i}`);
      const result = await ctx.autoCompressOutput(largeArray);

      expect(result).toHaveProperty('$cached');
    });

    it('should not compress array with 20 or fewer items', async () => {
      const smallArray = Array.from({ length: 20 }, (_, i) => `item-${i}`);
      const result = await ctx.autoCompressOutput(smallArray);

      expect(result).toEqual(smallArray);
    });

    it('should compress object with more than 20 keys', async () => {
      const largeObj: Record<string, string> = {};
      for (let i = 0; i < 21; i++) {
        largeObj[`key-${i}`] = `value-${i}`;
      }
      const result = await ctx.autoCompressOutput(largeObj);

      expect(result).toHaveProperty('$cached');
    });

    it('should not compress object with 20 or fewer keys', async () => {
      const smallObj: Record<string, string> = {};
      for (let i = 0; i < 20; i++) {
        smallObj[`key-${i}`] = `value-${i}`;
      }
      const result = await ctx.autoCompressOutput(smallObj);

      expect(result).toEqual(smallObj);
    });

    it('should recursively compress nested values', async () => {
      const nested = {
        short: 'short string',
        long: 'a'.repeat(1500),
        nested: {
          deep: 'b'.repeat(1500),
        },
      };

      const result = (await ctx.autoCompressOutput(nested)) as Record<
        string,
        unknown
      >;

      expect(result.short).toBe('short string');
      expect(result.long).toHaveProperty('$cached');
      expect((result.nested as Record<string, unknown>).deep).toHaveProperty(
        '$cached',
      );
    });
  });

  describe('autoResolveInput', () => {
    it('should resolve CachedReference', async () => {
      mockRedis.get.mockResolvedValueOnce('resolved content');

      const input = {
        key: 'value',
        cached: { $cached: 'cache_abc123', $size: 100 },
      };

      const result = (await ctx.autoResolveInput(input)) as Record<
        string,
        unknown
      >;

      expect(result.key).toBe('value');
      expect(result.cached).toBe('resolved content');
    });

    it('should recursively resolve nested CachedReferences', async () => {
      mockRedis.get
        .mockResolvedValueOnce('content1')
        .mockResolvedValueOnce('content2');

      const input = {
        nested: {
          ref1: { $cached: 'cache_1', $size: 100 },
          ref2: { $cached: 'cache_2', $size: 200 },
        },
      };

      const result = (await ctx.autoResolveInput(input)) as Record<
        string,
        unknown
      >;
      const nested = result.nested as Record<string, unknown>;

      expect(nested.ref1).toBe('content1');
      expect(nested.ref2).toBe('content2');
    });

    it('should resolve CachedReference in array', async () => {
      mockRedis.get.mockResolvedValueOnce('array content');

      const input = {
        items: [{ $cached: 'cache_arr', $size: 50 }],
      };

      const result = (await ctx.autoResolveInput(input)) as Record<
        string,
        unknown
      >;

      expect((result.items as unknown[])[0]).toBe('array content');
    });

    it('should not modify non-CachedReference objects', async () => {
      const input = {
        name: 'test',
        count: 42,
        flag: true,
      };

      const result = await ctx.autoResolveInput(input);

      expect(result).toEqual(input);
    });
  });
});
