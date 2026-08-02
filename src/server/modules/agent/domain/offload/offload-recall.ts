import type { LlmMessage } from '@/shared/types/entities';
import { ToolIds } from '@/shared/constants';
import type { ParsedAction } from '@/server/modules/agent/domain/port/agent-run-context.port';
import { parseAssistantAt } from './offload-stub';

/** 落盘文件名约定：fc_ + 恰好 8 hex（裸或 <hint>__fc_<hex>）；给 agent 指明收窄目标。 */
const FC_FILE_RE = /[A-Za-z0-9._-]*fc_[0-9a-f]{8}(?![0-9a-f])/;

// offload 句柄回取视图：再 offload 只会 fc→fc 别名；rg-on-fc 会逐轮延伸 alias 链到 iter 上限。
export type RecallKind = { type: 'bash'; file: string };

// recall 判定：tool===BASH 且命令含 fc 句柄 → 盘上句柄操作均回取视图，再 offload 必 fc→fc 别名 → 跳过。
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
