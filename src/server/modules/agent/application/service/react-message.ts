import { ToolIds } from '@/shared/constants';
import { Role } from '@/shared/entities/Message';
import { stripThinking } from '@/server/utils/llm-text';
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

// 空响应 nudge：追加到对话末尾（不动 system/前缀，保前缀缓存），驱动模型立即产出工具调用或最终答复
export const EMPTY_RESPONSE_NUDGE =
  'Observation: [System] Your previous response was empty. Provide a tool call now (or answer via response_user).';

// 控制流工具：改变 run 终态或协调态（应答/提问/换绑工具集），不参与多块并发
const CONTROL_FLOW_TOOLS = new Set<string>([
  ToolIds.RESPONSE_USER,
  ToolIds.ASK_USER,
  ToolIds.LIST_TOOLS,
  ToolIds.SKILL_CALL,
]);

/** 解析 ReAct 响应为动作数组：多个 <tool_call> 块 = 并发批；无包裹的裸 tool/input 按单动作兼容。 */
export function parseResponse(content: string): ParsedAction[] {
  const text = stripThinking(content);

  const blocks = [...text.matchAll(/<tool_call>([\s\S]*?)<\/tool_call>/gi)].map(
    m => m[1]!,
  );
  const actions = blocks.length ? blocks.map(parseBlock) : [parseBlock(text)];

  // 首块前的游离 <thought>（批级计划性思考）挂到首个无 thought 的动作上
  const firstBlockAt = text.indexOf('<tool_call>');
  const leadThought =
    firstBlockAt >= 0
      ? tagContent(text.slice(0, firstBlockAt), 'thought')
      : null;
  if (leadThought !== null && actions[0]?.thought === undefined) {
    actions[0] = {
      ...actions[0]!,
      thought: decodeXml(leadThought).trim() || undefined,
    };
  }

  if (actions.length > 1 && actions.some(a => CONTROL_FLOW_TOOLS.has(a.tool))) {
    throw new Error(
      'Invalid response: control-flow tools (response_user/ask_user/skill_call/list_tools) must be the only action in a response',
    );
  }
  return actions;
}

function parseBlock(block: string): ParsedAction {
  const toolRaw = tagContent(block, 'tool');
  const inputRaw = tagContent(block, 'input');
  const tool = toolRaw ? toolRaw.trim() : '';
  const input = inputRaw !== null ? parseInput(inputRaw) : null;

  if (!tool || !input) {
    throw new Error(
      'Invalid response: missing or invalid top-level `tool`/`input`',
    );
  }

  const thoughtRaw = tagContent(block, 'thought');
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

// ── 流式信封切分（react-loop 边流边发；与 parseResponse 同源维护 wire format）──
// thought 闭合即发；response_user 的 <message> 实体感知增量 → text_chunk；其余只缓冲。

const KNOWN_TAGS = [
  '<thought>',
  '</thought>',
  '<tool>',
  '</tool>',
  '<message>',
  '</message>',
];

const ENTITIES: Record<string, string> = {
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&apos;': "'",
  '&amp;': '&',
};

const CDATA_OPEN = '<![CDATA[';
const CDATA_CLOSE = ']]>';
const CLOSE_MESSAGE = '</message>';

/** text 结尾与 tag 互为前缀的最长片段（跨 chunk 标签保留）。 */
function overlappingSuffix(text: string, tag: string): string {
  const max = Math.min(text.length, tag.length - 1);
  for (let n = max; n > 0; n--) {
    if (tag.startsWith(text.slice(-n))) return text.slice(-n);
  }
  return '';
}

/** 实体感知解码：返回 [已解码输出, 需保留的尾部（潜在不完整实体，final 时为空）]。 */
function decodeEntities(text: string, final: boolean): [string, string] {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== '&') {
      out += text[i];
      continue;
    }
    const rest = text.slice(i);
    const hit = (Object.keys(ENTITIES) as string[]).find(e =>
      rest.startsWith(e),
    );
    if (hit) {
      out += ENTITIES[hit]!;
      i += hit.length - 1;
      continue;
    }
    const maybePartial =
      !final &&
      (Object.keys(ENTITIES) as string[]).some(
        e => e.startsWith(rest) && rest.length < e.length,
      );
    if (maybePartial) return [out, rest];
    out += '&';
  }
  return [out, ''];
}

export class ReActStreamSplitter {
  private mode: 'scan' | 'thought' | 'tool' | 'message' = 'scan';
  private pending = '';
  private thoughtBuf = '';
  private toolBuf = '';
  private toolName = '';
  private inCdata = false;

  /** 喂入一个增量，返回本段产出的事件。 */
  push(delta: string): RunEvent[] {
    this.pending += delta;
    return this.digest(false);
  }

  /** 流结束：冲刷残余（未闭合标签按字面收尾，与宽松解析一致）。 */
  flush(): RunEvent[] {
    return this.digest(true);
  }

  private emit(events: RunEvent[], text: string): void {
    if (text) events.push({ type: 'text_chunk', content: text });
  }

  private digest(final: boolean): RunEvent[] {
    const events: RunEvent[] = [];
    for (;;) {
      if (this.mode === 'scan') {
        const idx = this.pending.indexOf('<');
        if (idx < 0) {
          this.pending = '';
          break;
        }
        const rest = this.pending.slice(idx);
        const tag = KNOWN_TAGS.find(t => rest.startsWith(t));
        if (tag) {
          this.pending = rest.slice(tag.length);
          if (tag === '<thought>') this.mode = 'thought';
          else if (tag === '<tool>') this.mode = 'tool';
          else if (tag === '<message>' && this.toolName === 'response_user') {
            this.mode = 'message';
          }
          continue;
        }
        if (
          !final &&
          KNOWN_TAGS.some(t => t.startsWith(rest) && rest.length < t.length)
        ) {
          this.pending = rest;
          break;
        }
        this.pending = rest.slice(1);
        continue;
      }

      if (this.mode === 'thought' || this.mode === 'tool') {
        const isThought = this.mode === 'thought';
        const close = isThought ? '</thought>' : '</tool>';
        const idx = this.pending.indexOf(close);
        if (idx >= 0) {
          const body =
            (isThought ? this.thoughtBuf : this.toolBuf) +
            this.pending.slice(0, idx);
          this.pending = this.pending.slice(idx + close.length);
          this.mode = 'scan';
          if (isThought) {
            this.thoughtBuf = '';
            const content = decodeXml(body).trim();
            if (content) events.push({ type: 'thought', content });
          } else {
            this.toolBuf = '';
            this.toolName = body.trim();
          }
          continue;
        }
        const hold = overlappingSuffix(this.pending, close);
        if (isThought)
          this.thoughtBuf += this.pending.slice(0, -hold.length || undefined);
        else this.toolBuf += this.pending.slice(0, -hold.length || undefined);
        this.pending = hold;
        if (final && !hold) {
          // 未闭合：残余并入缓冲后丢弃（信封已坏，parse 阶段兜底）
          if (isThought) this.thoughtBuf = '';
          else this.toolBuf = '';
          this.pending = '';
        }
        break;
      }

      // mode === 'message'
      if (this.inCdata) {
        const idx = this.pending.indexOf(CDATA_CLOSE);
        if (idx >= 0) {
          this.emit(events, this.pending.slice(0, idx));
          this.pending = this.pending.slice(idx + CDATA_CLOSE.length);
          this.inCdata = false;
          continue;
        }
        const hold = overlappingSuffix(this.pending, CDATA_CLOSE);
        this.emit(events, this.pending.slice(0, -hold.length || undefined));
        this.pending = hold;
        break;
      }
      if (this.pending.startsWith('<')) {
        if (this.pending.startsWith(CDATA_OPEN)) {
          this.pending = this.pending.slice(CDATA_OPEN.length);
          this.inCdata = true;
          continue;
        }
        if (
          !final &&
          CDATA_OPEN.startsWith(this.pending) &&
          this.pending.length < CDATA_OPEN.length
        ) {
          break;
        }
      }

      const idx = this.pending.indexOf('<');
      const rawEnd = idx < 0 ? this.pending.length : idx;
      const raw = this.pending.slice(0, rawEnd);
      const tail = this.pending.slice(rawEnd);
      const [out, keep] = decodeEntities(raw, final);
      this.emit(events, out);

      if (idx < 0) {
        this.pending = keep;
        break;
      }
      if (tail.startsWith(CLOSE_MESSAGE)) {
        this.pending = keep + tail.slice(CLOSE_MESSAGE.length);
        this.mode = 'scan';
        continue;
      }
      if (
        !final &&
        CLOSE_MESSAGE.startsWith(tail) &&
        tail.length < CLOSE_MESSAGE.length
      ) {
        this.pending = keep + tail;
        break;
      }
      // 字面 '<'（模型未转义）：按字面输出，继续消费
      this.emit(events, '<');
      this.pending = keep + tail.slice(1);
    }
    return events;
  }
}
