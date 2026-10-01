import { WorkspaceService } from '@/server/infrastructure/workspace/workspace.service';

// @file 引用展开：user content 的 @path token → 文件内容注入（服务端模型，
// 展开只能在后端）。注入进 ctx（LLM 上下文）不落库——user 消息保持原文。

const MENTION_LIMIT = 64 * 1024; // 单文件注入上限
const TOTAL_LIMIT = 192 * 1024; // 单 turn 总注入上限
const MENTION_RE = /(?:^|\s)@([\w./~-][\w./~@-]*)/g;

/** 扫描 @path token（去重、限相对路径——防 /etc/passwd 类绝对路径注入）。 */
export function extractMentions(content: string): string[] {
  const seen = new Set<string>();
  for (const m of content.matchAll(MENTION_RE)) {
    const token = m[1]!;
    if (token.startsWith('/') || token.includes('..')) continue;
    seen.add(token);
  }
  return [...seen].slice(0, 8);
}

// 展开为追加段（返回 null 表示无可注入内容）。 消息原文不动；展开体以 <file path> 包裹 append 到 content 尾部供 LLM 消费。
export async function expandMentions(
  content: string,
  workDir: string,
  workspace: WorkspaceService,
): Promise<string | null> {
  const tokens = extractMentions(content);
  if (tokens.length === 0) return null;

  const blocks: string[] = [];
  let total = 0;
  for (const token of tokens) {
    if (total >= TOTAL_LIMIT) break;
    try {
      const file = await workspace.readFile(token, workDir);
      if (!file) continue;
      const body =
        file.content.length > MENTION_LIMIT
          ? `${file.content.slice(0, MENTION_LIMIT)}\n…(truncated)`
          : file.content;
      total += body.length;
      blocks.push(`<file path="${token}">\n${body}\n</file>`);
    } catch {
      // 读取失败跳过——LLM 收不到该文件，消息原文里的 @token 仍在可追问
    }
  }
  if (blocks.length === 0) return null;
  return blocks.join('\n');
}
