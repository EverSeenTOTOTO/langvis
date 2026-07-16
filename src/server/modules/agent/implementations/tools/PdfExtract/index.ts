import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { globby } from 'globby';
import { tool } from '@/server/decorator/core';
import { ToolIds } from '@/shared/constants';
import type { ToolConfig } from '@/shared/types';
import type { Logger } from '@/server/utils/logger';
import { Tool } from '@/server/modules/agent/domain/model/tool.base';
import type { ToolCallContext } from '@/server/modules/agent/domain/port/tool-call-context.port';
import type { RunEvent } from '@/shared/types/events';
import {
  normalizeRoot,
  shortenHome,
} from '@/server/modules/agent/infrastructure/authorization.provider';
import { selectStrategy, type ExtractRequest } from './strategy';
import type {
  PdfExtractInput,
  PdfExtractOutput,
  PdfFileResult,
} from './config';
import { config } from './config';

const GLOB_CHARS = /[*?[\]{}]/;

@tool(ToolIds.PDF_EXTRACT)
export default class PdfExtractTool extends Tool<PdfExtractOutput> {
  readonly id!: string;
  readonly config!: ToolConfig;
  protected readonly logger!: Logger;

  async *call(
    ctx: ToolCallContext,
  ): AsyncGenerator<RunEvent, PdfExtractOutput, void> {
    ctx.signal.throwIfAborted();

    const {
      path: rawPath,
      pages,
      maxCharsPerPage,
    } = ctx.input as unknown as PdfExtractInput;

    const expanded = expandPath(rawPath, ctx.workDir);
    const isOutside = isOutsideWorkspace(expanded, ctx.workDir);

    if (isOutside) {
      yield* ctx.auth.ensureApproved(
        ctx,
        'read-path',
        normalizeRoot(expanded),
        this.approvalForm(expanded),
      );
    }

    const matches = await resolveMatches(expanded);
    if (matches.length === 0) {
      return {
        files: [],
        totalFiles: 0,
        skipped: [{ path: rawPath, reason: 'No matching files' }],
      };
    }

    const request: ExtractRequest = { pages, maxCharsPerPage };
    const files: PdfFileResult[] = [];
    const skipped: { path: string; reason: string }[] = [];

    for (const filePath of matches) {
      ctx.signal.throwIfAborted();

      if (!filePath.toLowerCase().endsWith('.pdf')) {
        skipped.push({ path: filePath, reason: 'Not a .pdf file' });
        continue;
      }

      yield {
        type: 'tool_progress',
        callId: ctx.callId,
        data: {
          message: `Extracting ${shortenHome(filePath)}${pages ? ` pages=${pages}` : ''}`,
        },
      };

      try {
        const result = await selectStrategy().extract(filePath, request);
        files.push({ path: filePath, ...result });
      } catch (err) {
        skipped.push({
          path: filePath,
          reason: (err as Error).message ?? String(err),
        });
      }
    }

    const totalChars = files.reduce((s, f) => s + f.charCount, 0);
    yield {
      type: 'tool_progress',
      callId: ctx.callId,
      data: {
        message: `Extracted ${files.length}/${matches.length} file(s), ${totalChars} chars`,
      },
    };

    return { files, totalFiles: files.length, skipped };
  }

  /** 越界读取的 HITL 文案与表单。作用域 per-run，故承诺“本次运行内不再询问”。 */
  private approvalForm(expanded: string): {
    prompt: string;
    formSchema: object;
  } {
    const root = shortenHome(normalizeRoot(expanded));
    const prompt =
      `### 授权读取 PDF\n\n` +
      `PDF 工具请求读取工作区之外的文件，根目录：\n\n` +
      `\`${root}\`\n\n` +
      `本次授权后，本次运行内该目录下的 PDF 读取将不再逐次询问。`;
    const formSchema = {
      type: 'object' as const,
      properties: {
        confirmed: {
          type: 'boolean' as const,
          title: '允许读取该目录下的 PDF？',
          default: true,
        },
        remark: {
          type: 'string' as const,
          title: '备注',
          description: '可选，拒绝原因',
        },
      },
      required: ['confirmed'],
    };
    return { prompt, formSchema };
  }
}

export { config };

/** ~ 与未锚定路径展开为绝对路径；相对路径锚定到 workDir。 */
function expandPath(rawPath: string, workDir: string): string {
  if (rawPath.startsWith('~')) {
    return path.join(os.homedir(), rawPath.slice(1));
  }
  if (path.isAbsolute(rawPath)) {
    return rawPath;
  }
  return path.resolve(workDir, rawPath);
}

/**
 * 含通配符 → 视为越界（glob 可能命中 workDir 外）；否则绝对/~-路径越界，相对路径在沙箱内。
 */
function isOutsideWorkspace(expanded: string, workDir: string): boolean {
  if (GLOB_CHARS.test(expanded)) return true;
  if (!path.isAbsolute(expanded)) return false;
  const rel = path.relative(workDir, expanded);
  return rel.startsWith('..') || path.isAbsolute(rel);
}

async function resolveMatches(expanded: string): Promise<string[]> {
  if (!GLOB_CHARS.test(expanded)) {
    const exists = await fs
      .stat(expanded)
      .then(s => s.isFile())
      .catch(() => false);
    return exists ? [expanded] : [];
  }
  return globby([expanded], { absolute: true, onlyFiles: true });
}
