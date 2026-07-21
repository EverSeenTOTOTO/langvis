import type { LlmMessage } from '@/shared/types/entities';
import { parseResponse } from '@/server/modules/agent/application/service/react-loop';
import { ToolIds } from '@/shared/constants';

/** offload 落盘文件名约定：fc_ + 恰好 8 hex（裸 fc_<hex> 或 <hint>__fc_<hex>）。匹配整段文件名 token（含 hint 前缀），用于给 agent 指明收窄目标。 */
const FC_FILE_RE = /[A-Za-z0-9._-]*fc_[0-9a-f]{8}(?![0-9a-f])/;

/** 一条 observation 是否"盘上 offload 句柄的回取/视图"：再 offload 只会 fc→fc 别名。
 *  含 rg-on-fc 螺旋：对已过滤句柄再 rg 同关键词，输出≈原句柄，逐轮 alias 链可一路到 iter 上限。
 *  bash file 供 query-budget 写收窄指引；offload 只用 `!== null` 决定跳过。 */
export type RecallKind = { type: 'bash'; file: string };

/** 配对 assistant 的 tool === BASH ∧ 命令含 fc 句柄 → 在盘上句柄上的任意操作
 *  （cat/rg/sed/head/...）均回取/派生视图，再 offload 必 fc→fc 别名 → 跳过。 */
export function classifyRecall(
  messages: LlmMessage[],
  obsIndex: number,
): RecallKind | null {
  const assistant = messages[obsIndex - 1];
  if (!assistant || assistant.role !== 'assistant') return null;
  try {
    const { tool, input } = parseResponse(assistant.content);
    if (tool === ToolIds.BASH) {
      const cmd = (input as { command?: unknown }).command;
      if (typeof cmd !== 'string') return null;
      const m = cmd.match(FC_FILE_RE);
      return m ? { type: 'bash', file: m[0] } : null;
    }
    return null;
  } catch {
    return null;
  }
}
