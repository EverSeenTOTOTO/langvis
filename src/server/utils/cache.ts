import { promises as fs } from 'fs';
import path from 'path';
import { RedisKeys } from '@/shared/constants';
import { generateId } from '@/shared/utils';
import { container } from 'tsyringe';
import { RedisService } from '../service/RedisService';

export type CompressionStrategy = 'skip' | 'redis' | 'file';

export interface CachedReference {
  $cached: string;
  $size: number;
  $preview?: string;
}

export interface FilePathReference {
  $file: string;
  $size: number;
  $preview?: string;
}

function isCachedReference(value: unknown): value is CachedReference {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    '$cached' in value &&
    typeof (value as CachedReference).$cached === 'string'
  );
}

export const STRING_THRESHOLD = 20000;
export const ARRAY_THRESHOLD = 50;
export const PREVIEW_LENGTH = 200;
export const CACHE_TTL = 3600;

async function storeCache(
  messageId: string,
  value: unknown,
): Promise<CachedReference> {
  const key = generateId('cache');
  const serialized = typeof value === 'string' ? value : JSON.stringify(value);
  const redisService = container.resolve(RedisService);
  await redisService.client.setEx(
    RedisKeys.AGENT_CACHE(messageId, key),
    CACHE_TTL,
    serialized,
  );

  return {
    $cached: key,
    $size: Buffer.byteLength(serialized, 'utf8'),
    $preview:
      typeof value === 'string'
        ? value.slice(0, PREVIEW_LENGTH)
        : JSON.stringify(value).slice(0, PREVIEW_LENGTH),
  };
}

async function retrieveCache(messageId: string, key: string): Promise<unknown> {
  const redisService = container.resolve(RedisService);
  const data = await redisService.client.get(
    RedisKeys.AGENT_CACHE(messageId, key),
  );
  if (!data) {
    throw new Error(`Cache miss: ${key}`);
  }
  try {
    return JSON.parse(data);
  } catch {
    return data;
  }
}

async function storeFile(
  conversationId: string,
  value: unknown,
): Promise<FilePathReference> {
  const WorkspaceService = (await import('../service/WorkspaceService'))
    .WorkspaceService;
  const workspaceService = container.resolve(WorkspaceService);
  const workDir = await workspaceService.getWorkDir(conversationId);

  const serialized = typeof value === 'string' ? value : JSON.stringify(value);
  const filename = `fc_${generateId('')}`;
  const filePath = path.join(workDir, filename);
  await fs.writeFile(filePath, serialized, 'utf-8');

  return {
    $file: filename,
    $size: Buffer.byteLength(serialized, 'utf8'),
    $preview: serialized.slice(0, PREVIEW_LENGTH),
  };
}

function shouldCompress(value: unknown): boolean {
  if (typeof value === 'string') {
    return value.length > STRING_THRESHOLD;
  }
  if (Array.isArray(value)) {
    return value.length > ARRAY_THRESHOLD;
  }
  return false;
}

export async function compress(
  messageId: string,
  value: unknown,
  strategy: CompressionStrategy = 'redis',
  conversationId?: string,
): Promise<unknown> {
  if (strategy === 'skip') {
    return value;
  }

  if (strategy === 'file' && shouldCompress(value)) {
    if (!conversationId) {
      throw new Error('conversationId is required for file compression');
    }
    return storeFile(conversationId, value);
  }

  if (strategy === 'redis' && shouldCompress(value)) {
    return storeCache(messageId, value);
  }

  // For values below threshold, recurse into objects/arrays regardless of strategy
  if (Array.isArray(value)) {
    const result: unknown[] = [];
    for (const item of value) {
      result.push(await compress(messageId, item, strategy, conversationId));
    }
    return result;
  }

  if (value && typeof value === 'object' && !isCachedReference(value)) {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      result[key] = await compress(messageId, val, strategy, conversationId);
    }
    return result;
  }

  return value;
}

export async function resolve(
  messageId: string,
  value: unknown,
): Promise<unknown> {
  if (isCachedReference(value)) {
    return retrieveCache(messageId, value.$cached);
  }

  if (Array.isArray(value)) {
    const result: unknown[] = [];
    for (const item of value) {
      result.push(await resolve(messageId, item));
    }
    return result;
  }

  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      result[key] = await resolve(messageId, val);
    }
    return result;
  }

  return value;
}
