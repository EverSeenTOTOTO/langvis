import { promises as fs } from 'fs';
import path from 'path';
import { singleton, inject } from 'tsyringe';
import { generateId } from '@/shared/utils';
import { WorkspaceService } from './WorkspaceService';

export type CompressionStrategy = 'skip' | 'file';

export interface CachedReference {
  $cached: string;
  $size: number;
  $preview?: string;
}

export const STRING_THRESHOLD = 20000;
export const ARRAY_THRESHOLD = 50;
export const PREVIEW_LENGTH = 200;

export function isCachedReference(value: unknown): value is CachedReference {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    '$cached' in value &&
    typeof (value as CachedReference).$cached === 'string'
  );
}

@singleton()
export class CacheService {
  constructor(
    @inject(WorkspaceService)
    private readonly workspaceService: WorkspaceService,
  ) {}

  async compress(
    conversationId: string,
    value: unknown,
    strategy: CompressionStrategy = 'file',
  ): Promise<unknown> {
    if (strategy === 'skip') {
      return value;
    }

    if (this.shouldCompress(value)) {
      return this.storeFile(conversationId, value);
    }

    if (Array.isArray(value)) {
      const result: unknown[] = [];
      for (const item of value) {
        result.push(await this.compress(conversationId, item, strategy));
      }
      return result;
    }

    if (value && typeof value === 'object' && !isCachedReference(value)) {
      const result: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(value)) {
        result[key] = await this.compress(conversationId, val, strategy);
      }
      return result;
    }

    return value;
  }

  async resolve(conversationId: string, value: unknown): Promise<unknown> {
    if (isCachedReference(value)) {
      const workDir = await this.workspaceService.getWorkDir(conversationId);
      const fileResult = await this.workspaceService.readFile(
        value.$cached,
        workDir,
      );
      if (!fileResult) {
        throw new Error(`Cache miss: ${value.$cached}`);
      }
      try {
        return JSON.parse(fileResult.content);
      } catch {
        return fileResult.content;
      }
    }

    if (Array.isArray(value)) {
      const result: unknown[] = [];
      for (const item of value) {
        result.push(await this.resolve(conversationId, item));
      }
      return result;
    }

    if (value && typeof value === 'object') {
      const result: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(value)) {
        result[key] = await this.resolve(conversationId, val);
      }
      return result;
    }

    return value;
  }

  async readFile(
    conversationId: string,
    filename: string,
    offset?: number,
    limit?: number,
  ): Promise<string | Record<string, unknown>> {
    const workDir = await this.workspaceService.getWorkDir(conversationId);
    const fileResult = await this.workspaceService.readFile(filename, workDir);
    if (!fileResult) {
      throw new Error(`Cache miss: ${filename}`);
    }

    const content = fileResult.content;
    const sliced = limit
      ? content.slice(offset ?? 0, (offset ?? 0) + limit)
      : content.slice(offset ?? 0);

    try {
      return JSON.parse(sliced);
    } catch {
      return sliced;
    }
  }

  private async storeFile(
    conversationId: string,
    value: unknown,
  ): Promise<CachedReference> {
    const workDir = await this.workspaceService.getWorkDir(conversationId);
    const serialized =
      typeof value === 'string' ? value : JSON.stringify(value);
    const filename = `fc_${generateId('')}`;
    const filePath = path.join(workDir, filename);
    await fs.writeFile(filePath, serialized, 'utf-8');

    return {
      $cached: filename,
      $size: Buffer.byteLength(serialized, 'utf8'),
      $preview: serialized.slice(0, PREVIEW_LENGTH),
    };
  }

  private shouldCompress(value: unknown): boolean {
    if (typeof value === 'string') {
      return value.length > STRING_THRESHOLD;
    }
    if (Array.isArray(value)) {
      return value.length > ARRAY_THRESHOLD;
    }
    return false;
  }
}
