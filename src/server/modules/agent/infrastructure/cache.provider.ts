import { promises as fs } from 'fs';
import path from 'path';
import { singleton, inject } from 'tsyringe';
import { generateId } from '@/shared/utils';
import { WorkspaceService } from '@/server/libs/infrastructure/workspace.service';
import {
  isCachedReference,
  type CachePort,
  type CachedReference,
  type CompressionStrategy,
} from '@/server/modules/agent/domain/port/cache.port';

/*
 * Keep LLM context under STRING_THRESHOLD while preserving array/object shape
 * (counts, indices, small metadata) for LLM reasoning without cache reads.
 *
 * Dynamic threshold: childThreshold = max(min(parentThreshold, STRING_THRESHOLD/N), MIN_ITEM_THRESHOLD)
 *   - STRING_THRESHOLD/N: per-item budget so N items × budget ≈ STRING_THRESHOLD
 *   - min(parentThreshold): child may tighten but never loosen the parent budget
 *   - MIN_ITEM_THRESHOLD floor (2× standard ref size) avoids compressing strings
 *     so short the CachedReference would be larger than the original
 *
 * Arrays have a whole-compress fallback when recursive compression still exceeds
 * STRING_THRESHOLD; objects do not (rarely exceed after field-level compression).
 * resolve() first expands the outer ref, then recursively resolves inner ones.
 */

export const STRING_THRESHOLD = 20000;

// 同时决定 CachedReference 的 preview 长度：更短→更小 ref→更低 floor→更多 item 可见。
export const PREVIEW_LENGTH = 100;

// CachedReference 固定 JSON 开销（{"$cached":"fc_16","$size":5位,"$preview":"..."}，不含 preview）。
const CACHED_REF_FIXED_OVERHEAD = 55;
export const CACHED_REF_STANDARD_SIZE =
  CACHED_REF_FIXED_OVERHEAD + PREVIEW_LENGTH;

// 下限 = 2× 标准 ref 大小——只压缩明显大于 ref 本身的串，确保压缩总省上下文。
export const MIN_ITEM_THRESHOLD = CACHED_REF_STANDARD_SIZE * 2;

@singleton()
export class CacheProvider implements CachePort {
  constructor(
    @inject(WorkspaceService)
    private readonly workspaceService: WorkspaceService,
  ) {}

  async compress(
    workDir: string,
    value: unknown,
    strategy: CompressionStrategy = 'file',
    parentThreshold = STRING_THRESHOLD,
  ): Promise<unknown> {
    if (strategy === 'skip') {
      return value;
    }

    const threshold = parentThreshold;

    if (typeof value === 'string' && value.length > threshold) {
      return this.storeSerialized(workDir, value);
    }

    if (Array.isArray(value)) {
      const childThreshold = this.computeChildThreshold(
        value.length,
        threshold,
      );
      const result = await Promise.all(
        value.map(item =>
          this.compress(workDir, item, strategy, childThreshold),
        ),
      );
      const serialized = JSON.stringify(result);
      if (serialized.length > STRING_THRESHOLD) {
        return this.storeSerialized(workDir, serialized);
      }
      return result;
    }

    if (value && typeof value === 'object' && !isCachedReference(value)) {
      const entries = Object.entries(value);
      const childThreshold = this.computeChildThreshold(
        entries.length,
        threshold,
      );
      const result: Record<string, unknown> = {};
      for (const [key, val] of entries) {
        result[key] = await this.compress(
          workDir,
          val,
          strategy,
          childThreshold,
        );
      }
      return result;
    }

    return value;
  }

  async resolve(workDir: string, value: unknown): Promise<unknown> {
    if (isCachedReference(value)) {
      const expanded = await this.expandCached(workDir, value.$cached);
      // Expanded result may contain nested CachedReferences (e.g. whole-compressed
      // array whose items still have $cached fields) — resolve recursively
      return this.resolve(workDir, expanded);
    }

    if (Array.isArray(value)) {
      return Promise.all(value.map(item => this.resolve(workDir, item)));
    }

    if (value && typeof value === 'object') {
      const result: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(
        value as Record<string, unknown>,
      )) {
        result[key] = await this.resolve(workDir, val);
      }
      return result;
    }

    return value;
  }

  async readFile(
    workDir: string,
    filename: string,
    offset?: number,
    limit?: number,
  ): Promise<string | Record<string, unknown>> {
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

  private computeChildThreshold(
    childCount: number,
    parentThreshold: number,
  ): number {
    return Math.max(
      Math.min(parentThreshold, STRING_THRESHOLD / childCount),
      MIN_ITEM_THRESHOLD,
    );
  }

  private async storeSerialized(
    workDir: string,
    serialized: string,
  ): Promise<CachedReference> {
    const filename = `fc_${generateId('')}`;
    const filePath = path.join(workDir, filename);
    await fs.writeFile(filePath, serialized, 'utf-8');

    return {
      $cached: filename,
      $size: Buffer.byteLength(serialized, 'utf8'),
      $preview: serialized.slice(0, PREVIEW_LENGTH),
    };
  }

  private async expandCached(
    workDir: string,
    filename: string,
  ): Promise<unknown> {
    const fileResult = await this.workspaceService.readFile(filename, workDir);
    if (!fileResult) {
      throw new Error(`Cache miss: ${filename}`);
    }
    try {
      return JSON.parse(fileResult.content);
    } catch {
      return fileResult.content;
    }
  }
}
