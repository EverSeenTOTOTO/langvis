import { ToolIds } from '@/shared/constants';
import { Role } from '@/shared/entities/Message';
import { stripThinking } from '@/server/libs/llm-text';
import type {
  AgentRunContext,
  ParsedAction,
} from '@/server/modules/agent/domain/port/agent-run-context.port';
import type { LlmMessage } from '@/shared/types/entities';
import type { RunEvent } from '@/shared/types/events';

// ── ReAct XML 工具调用信封 codec（纯字符串 ↔ ParsedAction，零 agent 依赖）──

// parse 失败时回灌给模型的 Observation 前缀。eval 的 extractParseFailures 据此扫描统计
export const PARSE_ERROR_OBSERVATION_PREFIX =
  'Observation: Error parsing response: ';

export function parseResponse(content: string): ParsedAction {
  const text = stripThinking(content);

  const toolRaw = tagContent(text, 'tool');
  const inputRaw = tagContent(text, 'input');
  const tool = toolRaw ? toolRaw.trim() : '';
  const input = inputRaw !== null ? parseInput(inputRaw) : null;

  if (!tool || !input) {
    throw new Error(
      'Invalid response: missing or invalid top-level `tool`/`input`',
    );
  }

  const thoughtRaw = tagContent(text, 'thought');
  return {
    thought: thoughtRaw !== null ? decodeXml(thoughtRaw).trim() : undefined,
    tool,
    input,
  };
}

// XML 工具调用信封的序列化/反序列化——parse 与 serialize 同源维护 wire format。
// 参数值走 XML 文本内容，引号/反斜杠/花括号取字面、无需转义（只有 < & > 需），escape 压力从 JSON 挪走。

function decodeXml(text: string): string {
  return text
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function escapeXmlText(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function tagContent(text: string, tag: string): string | null {
  const m = text.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'i'));
  return m ? m[1]! : null;
}

// <input> 子标签 → {key: 值}：值优先按 JSON 字面量取（number/bool/null/数组/对象），失败作字面字符串。
// 无子标签回退 JSON 对象串；空 input（无参工具）→ {}。
function parseInput(inner: string): Record<string, unknown> {
  const obj: Record<string, unknown> = {};
  const re = /<([a-zA-Z_][\w-]*)>([\s\S]*?)<\/\1>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(inner)) !== null) {
    obj[m[1]!] = parseValue(decodeXml(m[2]!));
  }
  if (Object.keys(obj).length) return obj;
  try {
    const v = JSON.parse(inner) as unknown;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      return v as Record<string, unknown>;
    }
  } catch {
    // fall through
  }
  return {};
}

function parseValue(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** ParsedAction → XML 工具调用信封（与 parseResponse 互逆；offload 桩 / 合成 response_user / 历史还原共用）。 */
export function serializeAction(action: {
  thought?: string;
  tool: string;
  input: Record<string, unknown>;
}): string {
  const lines: string[] = ['<tool_call>'];
  if (action.thought != null) {
    lines.push(`  <thought>${escapeXmlText(action.thought)}</thought>`);
  }
  lines.push(`  <tool>${escapeXmlText(action.tool)}</tool>`, '  <input>');
  for (const [k, v] of Object.entries(action.input)) {
    // 字符串取字面文本（引号/反斜杠不转义）；非字符串 JSON 化，使 number/bool/对象可逆。
    const body = typeof v === 'string' ? v : JSON.stringify(v);
    lines.push(`    <${k}>${escapeXmlText(body)}</${k}>`);
  }
  lines.push('  </input>', '</tool_call>');
  return lines.join('\n');
}

// ── ctx 改写 helper（合成 response_user turn / 还原历史消息）──

/** 复刻 response_user 工具的可观测效果：yield text_chunk + append 一条 response_user ReAct XML。 */
export async function* responseUser(
  ctx: AgentRunContext,
  message: string,
): AsyncGenerator<RunEvent, void> {
  yield { type: 'text_chunk', content: message };
  ctx.messages.push({
    role: Role.ASSIST,
    content: serializeAction({
      tool: ToolIds.RESPONSE_USER,
      input: { message },
    }),
  });
}

/** assistant 文本 → response_user XML；LlmMessage.summary（源自 message.meta.summary）注入为 thought。 */
export function restoreReactMessage(m: LlmMessage): LlmMessage {
  return m.role === 'assistant'
    ? {
        role: 'assistant' as const,
        content: serializeAction({
          ...(m.summary ? { thought: m.summary } : {}),
          tool: ToolIds.RESPONSE_USER,
          input: { message: m.content },
        }),
      }
    : { role: m.role, content: m.content };
}
