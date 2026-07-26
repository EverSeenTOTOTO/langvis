import type { LlmMessage } from '@/shared/types/entities';
import { ToolIds } from '@/shared/constants';
import type { ParsedAction } from '@/server/modules/agent/domain/port/agent-run-context.port';
import { parseAssistantAt } from './offload-stub';

/** offload 落盘文件名约定：fc_ + 恰好 8 hex（裸 fc_<hex> 或 <hint>__fc_<hex>）。匹配整段文件名 token（含 hint 前缀），用于给 agent 指明收窄目标。 */
const FC_FILE_RE = /[A-Za-z0-9._-]*fc_[0-9a-f]{8}(?![0-9a-f])/;

/** 一条 observation 是否"盘上 offload 句柄的回取/视图"：再 offload 只会 fc→fc 别名。
 *  含 rg-on-fc 螺旋：对已过滤句柄再 rg 同关键词，输出≈原句柄，逐轮 alias 链可一路到 iter 上限。
 *  bash file 供 query-budget 写收窄指引；offload 只用 `!== null` 决定跳过。 */
export type RecallKind = { type: 'bash'; file: string };

/** 已解析配对 assistant action → recall 判定：tool === BASH ∧ 命令含 fc 句柄 → 在盘上句柄上的任意操作
 *  （cat/rg/sed/head/...）均回取/派生视图，再 offload 必 fc→fc 别名 → 跳过。
 *  纯函数、不 parse——与 hintForObservation 复用同一份 parseAssistantAt 索引，免双重 parse。 */
export function classifyRecallParsed(
  parsed: ParsedAction | null,
): RecallKind | null {
  if (!parsed || parsed.tool !== ToolIds.BASH) return null;
  const cmd = (parsed.input as { command?: unknown }).command;
  if (typeof cmd !== 'string') return null;
  const m = cmd.match(FC_FILE_RE);
  return m ? { type: 'bash', file: m[0] } : null;
}

/** 配对 assistant（obsIndex-1）的 recall 判定便捷入口：自解析；调用方已解析时直接用 classifyRecallParsed。 */
export function classifyRecall(
  messages: LlmMessage[],
  obsIndex: number,
): RecallKind | null {
  return classifyRecallParsed(parseAssistantAt(messages, obsIndex - 1));
}
