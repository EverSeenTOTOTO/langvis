import { ToolIds } from '@/shared/constants';
import { Role } from '@/shared/entities/Message';
import type { RunEvent } from '@/shared/types/events';
import { stripThinking } from '@/server/libs/llm-text';
import type {
  AgentRunContext,
  ParsedAction,
  ToolExecutor,
} from '@/server/modules/agent/domain/port/agent-run-context.port';
import type {
  HookDirective,
  HookPhase,
} from '@/server/modules/agent/domain/model/hook';
import { winstonLogger } from '@/server/utils/logger';

const logger = winstonLogger.child({ source: 'ReactLoop' });

/**
 * parse 失败时回灌给模型的 Observation 前缀。eval 的 extractParseFailures 据此扫描统计
 */
export const PARSE_ERROR_OBSERVATION_PREFIX =
  'Observation: Error parsing response: ';

async function* applyHooks(
  ctx: AgentRunContext,
  phase: HookPhase,
): AsyncGenerator<RunEvent, HookDirective, void> {
  const hooks = ctx.hooks?.forPhase(phase);
  if (!hooks) return 'next';
  for (const hook of hooks) {
    logger.debug(`hook ${hook.id} @ ${phase} (run ${ctx.runId})`);
    const d = yield* hook.apply(ctx); // yield* 透出 generator 的 return
    if (d !== 'next') return d; // continue/break 短路本相位余下 hook，原样冒泡给 loop
  }
  return 'next';
}

async function* exitLoop(ctx: AgentRunContext): AsyncGenerator<RunEvent, void> {
  yield* applyHooks(ctx, 'loop-exit');
}

export async function* runReactLoop(
  ctx: AgentRunContext,
  runTool: ToolExecutor,
): AsyncGenerator<RunEvent, void, void> {
  const model = ctx.config.runtimeConfig.model ?? {};

  for (;;) {
    ctx.signal.throwIfAborted();

    let d = yield* applyHooks(ctx, 'pre-llm');
    if (d === 'break') return yield* exitLoop(ctx);
    if (d === 'continue') continue;

    const iterMessages = ctx.messages.toArray();

    const content = await ctx.llm.chatContent(
      model.modelId,
      {
        messages: iterMessages,
        temperature: model.temperature,
        stop: ['Observation:', 'Observation：'],
      },
      ctx.signal,
    );

    if (!content) {
      throw new Error('No response from model');
    }

    logger.debug(`ReAct origin response: ${content}`);

    ctx.messages = ctx.messages.append({ role: Role.ASSIST, content });

    // 权威解析一次：parse 失败由 loop 统一兜底（error obs + continue），pre-action hook
    // 不再各自 parse + catch。解析成功挂到 ctx.pendingAction 供 pre-action hook 直读。
    let parsed: ParsedAction;
    try {
      parsed = parseResponse(content);
    } catch (error) {
      ctx.messages = ctx.messages.append({
        role: Role.USER,
        content:
          PARSE_ERROR_OBSERVATION_PREFIX +
          ((error as Error)?.message ?? String(error)),
      });

      d = yield* applyHooks(ctx, 'post-observation');
      if (d === 'break') return yield* exitLoop(ctx);
      continue;
    }
    ctx.pendingAction = parsed;

    d = yield* applyHooks(ctx, 'pre-action');
    if (d === 'break') return yield* exitLoop(ctx);
    if (d === 'continue') continue;

    const { tool, input } = parsed;

    if (parsed.thought) {
      yield { type: 'thought', content: parsed.thought };
    }

    const observation = yield* runTool(tool, input);

    if (tool === ToolIds.RESPONSE_USER) return yield* exitLoop(ctx);

    ctx.messages = ctx.messages.append({
      role: Role.USER,
      content: `Observation: ${observation}\n`,
    });

    d = yield* applyHooks(ctx, 'post-observation');
    if (d === 'break') return yield* exitLoop(ctx);
    // 'next' | 'continue' → 自然进入下一轮迭代
  }
}

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

// ─── XML 工具调用信封的序列化/反序列化 ───
// parse 与 serialize 同源，集中维护 wire format：参数值走 XML 文本内容，引号/反斜杠/花括号
// 取字面、无需转义（只有 < & > 需），把 escape 压力从 JSON 字符串值挪走（见 base-prompt XML 段）。

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

/** <input> 子标签 → {key: 值}。值优先按 JSON 字面量取（number/bool/null/数组/对象），失败则作字面
 *  字符串（引号/反斜杠原样，无需转义）。无子标签则回退 JSON 对象串；空 input（无参工具）→ {}。 */
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
