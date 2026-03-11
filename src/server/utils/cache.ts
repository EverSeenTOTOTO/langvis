import { InjectTokens, RedisKeys } from '@/shared/constants';
import { generateId } from '@/shared/utils';
import type { RedisClientType } from 'redis';
import { container } from 'tsyringe';

export interface CachedReference {
  $cached: string;
  $size: number;
  $preview?: string;
}

const STRING_THRESHOLD = 1000;

/**
 * Compress a large string value to Redis cache.
 * Returns the original value if under threshold.
 */
export async function compressIfNeeded(
  traceId: string,
  value: string,
  options?: { preview?: number; threshold?: number },
): Promise<string | CachedReference> {
  const threshold = options?.threshold ?? STRING_THRESHOLD;

  if (value.length < threshold) {
    return value;
  }

  const key = generateId('cache');
  const redis = container.resolve<RedisClientType<any>>(InjectTokens.REDIS);
  await redis.setEx(RedisKeys.AGENT_CACHE(traceId, key), 3600, value);

  return {
    $cached: key,
    $size: Buffer.byteLength(value, 'utf8'),
    $preview: value.slice(0, options?.preview ?? 200),
  };
}

/**
 * Retrieve cached value from Redis.
 */
export async function retrieveCached(
  traceId: string,
  key: string,
): Promise<string> {
  const redis = container.resolve<RedisClientType<any>>(InjectTokens.REDIS);
  const data = await redis.get(RedisKeys.AGENT_CACHE(traceId, key));
  if (!data) {
    throw new Error(`Cache miss: ${key}`);
  }
  return data;
}
