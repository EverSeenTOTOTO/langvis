import { ToolIds } from '@/shared/constants';
import { Role } from '@/shared/entities/Message';
import type { RunEvent } from '@/shared/types/events';
import { stripThinking } from '@/server/libs/llm-text';
import type {
  AgentRunContext,
  ToolExecutor,
} from '@/server/modules/agent/domain/port/agent-run-context.port';
import type {
  HookDirective,
  HookPhase,
} from '@/server/modules/agent/domain/model/hook';
import { winstonLogger } from '@/server/utils/logger';

const logger = winstonLogger.child({ source: 'ReactLoop' });

type ReActAction = {
  thought?: string;
  tool: string;
  input: Record<string, unknown>;
};

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

    ctx.messages = ctx.messages.append({ role: Role.ASSIST, content });

    d = yield* applyHooks(ctx, 'post-llm');
    if (d === 'break') return yield* exitLoop(ctx);
    if (d === 'continue') continue;

    let parsed: ReActAction;
    try {
      parsed = parseResponse(content);
    } catch (error) {
      ctx.messages = ctx.messages.append({
        role: Role.USER,
        content: `Observation: Error parsing response: ${(error as Error)?.message ?? String(error)}`,
      });

      d = yield* applyHooks(ctx, 'post-observation');
      if (d === 'break') return yield* exitLoop(ctx);
      continue;
    }

    logger.info('ReAct parsed response: ', parsed);

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

export function parseResponse(content: string): ReActAction {
  const parsed = JSON.parse(extractJsonObject(stripThinking(content))) as {
    tool?: unknown;
    input?: unknown;
    thought?: unknown;
  };

  if (
    typeof parsed.tool === 'string' &&
    parsed.tool.length > 0 &&
    parsed.input &&
    typeof parsed.input === 'object'
  ) {
    return {
      thought: parsed.thought ? String(parsed.thought) : undefined,
      tool: parsed.tool,
      input: parsed.input as Record<string, unknown>,
    };
  }

  throw new Error(
    'Invalid response: missing or invalid top-level `tool`/`input`',
  );
}

/**
 * Pull the first balanced `{…}` out of the response so leading reasoning
 * residue, prose, or stray ```json fences can't break parsing. String-aware
 * (braces inside `"…"` don't affect depth) and free of regex on the JSON
 * hierarchy; deliberately does NOT strip fences globally, since a string value
 * may legitimately contain triple backticks.
 */
function extractJsonObject(text: string): string {
  const start = text.indexOf('{');
  if (start === -1) {
    throw new Error('no JSON object in response');
  }

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];

    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }

    if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }

  throw new Error('unbalanced braces in response');
}
