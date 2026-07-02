import { ToolIds } from '@/shared/constants';
import { Role } from '@/shared/entities/Message';
import type { ModelConfig } from '@/shared/types';
import type { RunEvent } from '@/shared/types/events';
import { stripThinking } from '@/server/libs/llm-text';
import type { AgentRunContext } from '@/server/modules/agent/domain/port/agent-run-context.port';
import { winstonLogger } from '@/server/utils/logger';

const logger = winstonLogger.child({ source: 'ReactLoop' });

const MAX_ITERATIONS = Number.MAX_SAFE_INTEGER;

type ReActAction = {
  thought?: string;
  tool: string;
  input: Record<string, unknown>;
};

export async function* runReactLoop(
  ctx: AgentRunContext,
): AsyncGenerator<RunEvent, void, void> {
  const model =
    (ctx.config.runtimeConfig as { model?: ModelConfig }).model ?? {};

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    ctx.signal.throwIfAborted();

    const iterMessages = await ctx.workingMemory.buildContext();

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

    ctx.workingMemory.append(Role.ASSIST, content);

    let parsed: ReActAction;
    try {
      parsed = parseResponse(content);
    } catch (error) {
      const observation = `Error parsing response: ${(error as Error)?.message ?? String(error)}`;
      ctx.workingMemory.append(Role.USER, `Observation: ${observation}`);
      await ctx.workingMemory.compact(ctx.signal);
      yield { type: 'loop_usage', ...ctx.workingMemory.getContextUsage() };
      continue;
    }

    logger.info('ReAct parsed response: ', parsed);

    const { tool, input } = parsed;

    if (parsed.thought) {
      yield { type: 'thought', content: parsed.thought };
    }

    const observation = yield* ctx.executeTool(tool, input);

    // response_user 是终态工具（交付最终结果后结束本轮）。
    if (tool === ToolIds.RESPONSE_USER) {
      const summary = await ctx.workingMemory.foldProcessSummary(ctx.signal);
      if (summary) yield { type: 'process_summary', summary };
      return;
    }

    ctx.workingMemory.append(Role.USER, `Observation: ${observation}\n`);
    await ctx.workingMemory.compact(ctx.signal);
    yield { type: 'loop_usage', ...ctx.workingMemory.getContextUsage() };
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
