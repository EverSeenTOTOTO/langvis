import { ToolIds } from '@/shared/constants';
import { Role } from '@/shared/entities/Message';
import type { RunEvent } from '@/shared/types/events';
import { stripThinking } from '@/server/libs/llm-text';
import type { AgentRunContext } from '@/server/modules/agent/domain/port/agent-run-context.port';
import type { HookPhase } from '@/server/modules/agent/domain/model/hook';
import { winstonLogger } from '@/server/utils/logger';

const logger = winstonLogger.child({ source: 'ReactLoop' });

const MAX_ITERATIONS = Number.MAX_SAFE_INTEGER;

type ReActAction = {
  thought?: string;
  tool: string;
  input: Record<string, unknown>;
};

async function* applyHooks(
  ctx: AgentRunContext,
  phase: HookPhase,
): AsyncGenerator<RunEvent, void, void> {
  const hooks = ctx.hooks?.forPhase(phase);
  if (!hooks) return;
  for (const hook of hooks) {
    logger.debug(`hook ${hook.id} @ ${phase} (run ${ctx.runId})`);
    yield* hook.apply(ctx);
  }
}

export async function* runReactLoop(
  ctx: AgentRunContext,
): AsyncGenerator<RunEvent, void, void> {
  const model = ctx.config.runtimeConfig.model ?? {};

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    ctx.signal.throwIfAborted();
    yield* applyHooks(ctx, 'pre-llm');

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

    yield* applyHooks(ctx, 'post-llm');

    let parsed: ReActAction;
    try {
      parsed = parseResponse(content);
    } catch (error) {
      ctx.messages = ctx.messages.append({
        role: Role.USER,
        content: `Observation: Error parsing response: ${(error as Error)?.message ?? String(error)}`,
      });

      yield* applyHooks(ctx, 'post-observation');

      continue;
    }

    logger.info('ReAct parsed response: ', parsed);

    const { tool, input } = parsed;

    if (parsed.thought) {
      yield { type: 'thought', content: parsed.thought };
    }

    const observation = yield* ctx.executeTool(tool, input);

    if (tool === ToolIds.RESPONSE_USER) {
      yield* applyHooks(ctx, 'loop-exit');
      return;
    }

    ctx.messages = ctx.messages.append({
      role: Role.USER,
      content: `Observation: ${observation}\n`,
    });

    yield* applyHooks(ctx, 'post-observation');
  }

  throw new Error('Max iterations reached');
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
