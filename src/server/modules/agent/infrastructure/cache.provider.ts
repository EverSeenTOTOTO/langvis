import { promises as fs } from 'fs';
import path from 'path';
import { singleton, inject } from 'tsyringe';
import { generateId } from '@/shared/utils';
import { WorkspaceService } from '@/server/libs/infrastructure/workspace.service';
import {
  isCachedReference,
  type CachePort,
  type CachedReference,
} from '@/server/modules/agent/domain/port/cache.port';

/*
 * CachePort 实现。落盘入口只有 offload（pre-LLM 预算化 hook 用）：始终写盘返 CachedReference，
 * 文件名带语义 hint。resolve 把 $cached 引用（含嵌套）展开回原值；readFile 支持分页读。
 */

// $preview 长度：桩里露的预览，供 LLM 不读正文即判断该不该 page-in。
export const PREVIEW_LENGTH = 100;

/**
 * 把语义 hint（tool + 关键入参）规整为文件名安全段：小写、非 [a-z0-9] 替 -、
 * 压连续分隔、去首尾分隔、截断。空/纯符号 → ''（调用方据此退 fc_<id>）。
 */
function sanitizeHint(hint?: string): string {
  if (!hint) return '';
  return hint
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

@singleton()
export class CacheProvider implements CachePort {
  constructor(
    @inject(WorkspaceService)
    private readonly workspaceService: WorkspaceService,
  ) {}

  async offload(
    workDir: string,
    value: unknown,
    hint?: string,
  ): Promise<CachedReference> {
    const serialized =
      typeof value === 'string' ? value : JSON.stringify(value);
    return this.storeSerialized(workDir, serialized, hint);
  }

  async resolve(workDir: string, value: unknown): Promise<unknown> {
    if (isCachedReference(value)) {
      const expanded = await this.expandCached(workDir, value.$cached);
      // Expanded result may contain nested CachedReferences (e.g. an array whole-
      // cached whose items still have $cached fields) — resolve recursively.
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

  private async storeSerialized(
    workDir: string,
    serialized: string,
    hint?: string,
  ): Promise<CachedReference> {
    const sanitized = sanitizeHint(hint);
    // 无 hint 退 fc_<id>（保 /^fc_/ 既有契约）；有 hint 前置语义段 + '__fc_' 分隔。
    const id = generateId('fc');
    const filename = sanitized ? `${sanitized}__${id}` : id;
    const filePath = path.join(workDir, filename);
    await fs.writeFile(filePath, serialized, 'utf-8');

    return {
      $cached: filename,
      $size: Buffer.byteLength(serialized, 'utf8'),
      $preview: serialized.slice(0, PREVIEW_LENGTH),
      ...(sanitized ? { $label: sanitized } : {}),
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
