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
 * Compression Strategy Overview
 *
 * Goal: keep LLM context under STRING_THRESHOLD while maximizing structure
 * visibility so the LLM can reason about array/object shape (count, indices,
 * small metadata) without reading cache files.
 *
 * Rules:
 *
 * 1. Strings — use the threshold passed from parent context (parentThreshold).
 *    Top-level strings use STRING_THRESHOLD. Strings inside arrays/objects
 *    use a tighter threshold derived from the child count.
 *
 * 2. Arrays — recursive compression with dynamic threshold, then fallback:
 *    a) Compute childThreshold for items (see formula below).
 *    b) Recursively compress each item with childThreshold.
 *    c) If the resulting JSON still exceeds STRING_THRESHOLD → whole-compress
 *       the recursively-compressed result as a single CachedReference.
 *    d) If the result fits → return the visible array structure.
 *
 * 3. Objects — same as arrays: compute childThreshold from field count,
 *    recursively compress each field. No whole-compress fallback for objects
 *    (objects rarely exceed STRING_THRESHOLD after field-level compression).
 *
 * 4. Dynamic threshold formula:
 *    childThreshold = max(min(parentThreshold, STRING_THRESHOLD / N), MIN_ITEM_THRESHOLD)
 *
 *    - STRING_THRESHOLD / N  — per-item budget ensuring N items × budget ≈ STRING_THRESHOLD
 *    - parentThreshold       — respect the parent's budget; child can tighten but not loosen
 *    - MIN_ITEM_THRESHOLD    — floor = 2 × CACHED_REF_STANDARD_SIZE, prevents compressing
 *      strings so short that the CachedReference itself would be larger than the original
 *
 * 5. Threshold propagation:
 *    When a structure (array/object) is inside another structure, it inherits
 *    the parent's threshold but may tighten it based on its own child count.
 *    The min() rule ensures children never exceed the parent budget.
 *
 * 6. Whole-compress fallback (arrays only):
 *    When even recursive compression produces output exceeding STRING_THRESHOLD,
 *    the entire result is serialized to a single file. resolve() first expands
 *    the outer CachedReference, then recursively resolves any inner ones.
 */

// --- Thresholds and sizes ---
export const STRING_THRESHOLD = 20000;

// Preview length also determines CachedReference visible size.
// Shorter preview → smaller CachedReference → lower MIN_ITEM_THRESHOLD →
// more items can stay visible in arrays.
export const PREVIEW_LENGTH = 100;

// Approximate fixed JSON overhead for CachedReference keys:
// {"$cached":"fc_16chars","$size":5digits,"$preview":"..."}
// ≈ 55 chars excluding preview content
const CACHED_REF_FIXED_OVERHEAD = 55;

// Standard size of a CachedReference when serialized: fixed overhead + full preview
export const CACHED_REF_STANDARD_SIZE =
  CACHED_REF_FIXED_OVERHEAD + PREVIEW_LENGTH;

// Floor threshold = 2 × standard CachedReference size.
// Only compress strings significantly larger than the reference itself,
// so compression always yields meaningful context savings.
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

    // String: compress if exceeds current threshold
    if (typeof value === 'string' && value.length > threshold) {
      return this.storeSerialized(workDir, value);
    }

    // Array: recursive compression with dynamic threshold + whole-compress fallback
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
      // Fallback: if visible structure still exceeds STRING_THRESHOLD, whole-compress
      const serialized = JSON.stringify(result);
      if (serialized.length > STRING_THRESHOLD) {
        return this.storeSerialized(workDir, serialized);
      }
      return result;
    }

    // Object: recursive compression with dynamic threshold
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
