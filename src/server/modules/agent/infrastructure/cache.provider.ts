import { promises as fs } from 'fs';
import path from 'path';
import { inject, singleton } from 'tsyringe';
import { generateId } from '@/shared/utils';
import Logger from '@/server/utils/logger';
import { WorkspaceLocalStore } from '@/server/libs/infrastructure/workspace-local-store';
import {
  type CachePort,
  type CachedReference,
} from '@/server/modules/agent/domain/port/cache.port';

const logger = Logger.child({ source: 'CacheProvider' });

// CachePort 实现：offload 始终写盘返 CachedReference，文件名带语义 hint；读端经 bash rg/sed/head 检索。

// $preview 长度：桩里露的预览，供 LLM 不读正文即判断该不该 page-in。
export const PREVIEW_LENGTH = 100;

// 把语义 hint（tool + 关键入参）规整为文件名安全段：小写、非 [a-z0-9] 替 -、 压连续分隔、去首尾分隔、截断。空/纯符号 → ''（调用方据此退 fc_<id>）。
function sanitizeHint(hint?: string): string {
  if (!hint) return '';
  return hint
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

/** 折行宽度上限：rg 命中后单行回显不致溢出（8k 上下文模型也吃得下）。 */
const MAX_GREP_LINE = 1000;

// offload 落盘内容 reflow 成 rg 友好形：紧凑 JSON 解转义后 JSON.parse+缩进裂行，rg -C3 才能切出片段。
// bash 形（stdout 含 \n）解析失败落 wrapLongLines 兜底；resolve 时缩进形 JSON.parse 仍等价原值。
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
    const unescaped = s.replace(
      /\\(\\|"|\/|n|r|t|b|f|u([0-9a-fA-F]{4}))/g,
      (m, c: string, hex?: string) =>
        c === 'u'
          ? String.fromCharCode(parseInt(hex!, 16))
          : (JSON_ESCAPES[c] ?? m),
    );
    // 紧凑 JSON 无转义 → unescape no-op → 仍单行；结构化裂行（bash 形此处 parse 失败 → 落兜底）。
    try {
      const pretty = JSON.stringify(JSON.parse(unescaped), null, 2);
      if (pretty.includes('\n')) return pretty;
    } catch {
      // 非法 JSON（bash 真换行情形）→ wrapLongLines 兜底。
    }
    return wrapLongLines(unescaped, MAX_GREP_LINE);
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
    @inject(WorkspaceLocalStore) private readonly store: WorkspaceLocalStore,
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

  private async storeSerialized(
    workDir: string,
    serialized: string,
    hint?: string,
  ): Promise<CachedReference> {
    const sanitized = sanitizeHint(hint);
    // 无 hint 退 fc_<id>（保 /^fc_/ 既有契约）；有 hint 前置语义段 + '__fc_' 分隔。
    const id = generateId('fc');
    const filename = sanitized ? `${sanitized}__${id}` : id;
    // offload 侧车件收进 workspace 的 .langvis/offload 命名空间（dir 由 WorkspaceLocalStore 预建）；
    // $cached 为 workDir 相对路径（读端 bash cwd=workDir 可直接 rg/sed）。
    const rel = await this.store.reserveBlob(workDir, 'offload', filename);
    // 落盘前 reflow：把一整行 JSON（text 字段全转义 \n）裂成多行，否则 rg 一命中就回整条 885KB 巨行。
    const stored = reflowForGrep(serialized);
    await fs.writeFile(path.join(workDir, rel), stored, 'utf-8');
    logger.debug('offloaded to file', {
      filename,
      size: Buffer.byteLength(stored, 'utf8'),
    });

    return {
      $cached: rel,
      $size: Buffer.byteLength(stored, 'utf8'),
      $preview: stored.slice(0, PREVIEW_LENGTH),
      ...(sanitized ? { $label: sanitized } : {}),
    };
  }
}
