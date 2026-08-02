import type { LlmMessage } from '@/shared/types/entities';
import {
  parseResponse,
  serializeAction,
} from '@/server/modules/agent/application/service/react-loop';
import { ToolIds } from '@/shared/constants';
import type { ParsedAction } from '@/server/modules/agent/domain/port/agent-run-context.port';
import type { CachedReference } from '@/server/modules/agent/domain/port/cache.port';

export const OBSERVATION_PREFIX = 'Observation: ';
export const OFFLOADED_MARK = '[offloaded to file'; // 已桩标记 → 跳过重复桩
export const HEAD_KEEP = 256; // 裸 user 桩化保留头部（保 skill 触发 / 元信息）
export const CHUNK_SIZE = 2000; // 块大小单位：估 chunks 分叉策略，兼作「短于一个 chunk 不桩」下限
export const LARGE_CHUNK_THRESHOLD = 10; // 超此块数 → 大文件，只劝 rg 不劝分页

/** 桩候选 */
export type Candidate =
  | { kind: 'observation'; body: string }
  | { kind: 'bare'; body: string }
  | { kind: 'assistant'; body: string; parsed: ParsedAction };

// 取候选正文用于体积评估 + 落盘；assistant 候选即整条 ReAct 报文原文，顺带解析一次供下游复用。
export function candidateBody(msg: LlmMessage): Candidate | null {
  if (msg.role === 'user') {
    if (msg.content.startsWith(OBSERVATION_PREFIX)) {
      return {
        kind: 'observation',
        body: msg.content.slice(OBSERVATION_PREFIX.length),
      };
    }
    return { kind: 'bare', body: msg.content };
  }
  if (msg.role === 'assistant') {
    // 仅当可解析为 ReAct 报文时才作候选——不可解析的 assistant（如自由文本）不动。
    try {
      const parsed = parseResponse(msg.content);
      return { kind: 'assistant', body: msg.content, parsed };
    } catch {
      return null;
    }
  }
  return null;
}

// 桩正文生成：observation 全替；bare 保 HEAD_KEEP 头部；assistant 重建 `{tool, input:{_offloaded}}`。
// 大文件只劝 rg，小文件劝 sed -n 分页（整读必爆窗）；读端 hint 两处一致。
export function stubContent(
  candidate: Candidate,
  stub: CachedReference,
  hint: string,
): string {
  const chunks = Math.ceil(stub.$size / CHUNK_SIZE) || 1;
  const fn = stub.$cached;
  const large = chunks > LARGE_CHUNK_THRESHOLD;
  // 读端统一优先 rg（按关键词检索命中行）——勿 cat/head 整文件（整读必把全文搬回上下文→爆窗）。
  // 大文件只劝 rg；小文件 rg 为主，确需顺序看限行用 sed -n <range>（仍禁 cat/head -n 大行数）。
  const strategy = large
    ? `large file (~${chunks} chunks): via the bash tool, search on demand with rg -n "<keyword>" -C3 ${fn} (or grep); do NOT cat or page the whole file (it would overflow the window).`
    : `small file (~${chunks} chunks): via the bash tool, search with rg -n "<keyword>" -C3 ${fn} first; only if you need a contiguous range use sed -n "<range>" ${fn} (never cat or head the whole file).`;
  const marker =
    `${OFFLOADED_MARK} ${fn}] ${hint ? `(${hint}) ` : ''}size=${stub.$size}B` +
    ` (~${chunks} chunks of ${CHUNK_SIZE}B). The full content is saved as file ${fn} in your workDir (bash cwd=workDir). ${strategy}`;

  if (candidate.kind === 'observation') {
    return `${OBSERVATION_PREFIX}${marker}`;
  }
  if (candidate.kind === 'bare') {
    return `${candidate.body.slice(0, HEAD_KEEP)}\n${marker}`;
  }
  // assistant：整条报文一次性落盘，thought+input 同注一文件，tool 取已解析的 parsed.tool 原样保留。
  return serializeAction({
    thought: marker,
    tool: candidate.parsed.tool,
    input: { _offloaded: fn },
  });
}

// ReAct action → hint：tool + 首个 scalar 入参；bash 取命令动词。纯函数，调用方一次性解析后复用。
export function hintFromAction(parsed: ParsedAction): string {
  const { tool, input } = parsed;
  if (tool === ToolIds.BASH) {
    const cmd = (input as { command?: unknown }).command;
    const verb = typeof cmd === 'string' ? cmd.trim().split(/\s+/)[0]! : '';
    return verb ? `${tool}-${verb}` : tool;
  }
  const scalar = firstScalar(input);
  return scalar ? `${tool}-${scalar}` : tool;
}

/** Observation 的 hint：配对 assistant（obsIndex-1）的已解析 action → hint。无配对 / 解析失败 → ''。 */
export function hintForObservation(
  messages: LlmMessage[],
  obsIndex: number,
  paired?: ParsedAction | null,
): string {
  const parsed = paired ?? parseAssistantAt(messages, obsIndex - 1);
  return parsed ? hintFromAction(parsed) : '';
}

/** 裸 user 的 hint：正文首行作 label。 */
export function hintForUser(body: string): string {
  const firstLine = body.split('\n')[0]?.trim() ?? '';
  return firstLine.slice(0, 32);
}

// 解析 messages[i] 的 assistant action；不可解析 → null。hook 一次性建索引复用，避免各路径重复 parse。
export function parseAssistantAt(
  messages: LlmMessage[],
  i: number,
): ParsedAction | null {
  const m = messages[i];
  if (!m || m.role !== 'assistant') return null;
  try {
    return parseResponse(m.content);
  } catch {
    return null;
  }
}

function firstScalar(input: Record<string, unknown>): string | null {
  for (const v of Object.values(input)) {
    if (typeof v === 'string' && v.length > 0) return v.slice(0, 32);
    if (typeof v === 'number') return String(v);
  }
  return null;
}
