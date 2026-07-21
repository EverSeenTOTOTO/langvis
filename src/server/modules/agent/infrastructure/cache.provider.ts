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
 * 文件名带语义 hint。resolve 把 $cached 引用（含嵌套）展开回原值；agent 经 bash rg/sed/head 检索盘上件。
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

/** 折行宽度上限：rg 命中后单行回显不致失控（8k 上下文模型也吃得下）。 */
const MAX_GREP_LINE = 2000;

/** offload 落盘内容 reflow 成 rg 友好形：剥 untrusted 包裹后递归；JSON 形单遍解 JSON 字符串转义
 *  （\\ 作整体消费，不误伤字面反斜杠）；非 JSON 形按空白折到 MAX_GREP_LINE。
 *  落盘件只供 bash rg/sed/head 检索，不 JSON.parse。 */
const JSON_ESCAPES: Record<string, string> = {
  '\\': '\\',
  '"': '"',
  '/': '/',
  n: '\n',
  r: '\r',
  t: '\t',
  b: '\b',
  f: '\f',
};
function reflowForGrep(s: string): string {
  const untrusted =
    /^<untrusted_content>\n([\s\S]*)\n<\/untrusted_content>\s*$/.exec(s);
  if (untrusted) {
    return `<untrusted_content>\n${reflowForGrep(untrusted[1]!)}\n</untrusted_content>`;
  }
  if (/^\s*[{[]/.test(s)) {
    return s.replace(
      /\\(\\|"|\/|n|r|t|b|f|u([0-9a-fA-F]{4}))/g,
      (m, c: string, hex?: string) =>
        c === 'u'
          ? String.fromCharCode(parseInt(hex!, 16))
          : (JSON_ESCAPES[c] ?? m),
    );
  }
  return wrapLongLines(s, MAX_GREP_LINE);
}

/** 把超过 width 的行在最近空白处折行（无空白则硬折），保证每行 ≤ width。 */
function wrapLongLines(text: string, width: number): string {
  const out: string[] = [];
  for (const line of text.split('\n')) {
    let remaining = line;
    while (remaining.length > width) {
      let cut = remaining.lastIndexOf(' ', width);
      if (cut <= 0) cut = width;
      out.push(remaining.slice(0, cut));
      remaining = remaining.slice(cut).replace(/^ /, '');
    }
    out.push(remaining);
  }
  return out.join('\n');
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
    // 落盘前 reflow：把一整行 JSON（text 字段全转义 \n）裂成多行，否则 rg 一命中就回整条 885KB 巨行。
    const stored = reflowForGrep(serialized);
    await fs.writeFile(filePath, stored, 'utf-8');

    return {
      $cached: filename,
      $size: Buffer.byteLength(stored, 'utf8'),
      $preview: stored.slice(0, PREVIEW_LENGTH),
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
