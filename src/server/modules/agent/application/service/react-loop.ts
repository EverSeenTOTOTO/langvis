import { ToolIds } from '@/shared/constants';
import { Role } from '@/shared/entities/Message';
import type { ModelConfig } from '@/shared/types';
import type { RunEvent } from '@/shared/types/events';
import type { AgentRunContext } from '@/server/modules/agent/domain/port/agent-run-context.port';
import { LoopUsageReported } from '@/server/modules/agent/contracts';
import { createDomainEvent } from '@/server/libs/ddd';
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

  const reportUsage = async () => {
    await ctx.workingMemory.compact(ctx.signal);
    const { used, total } = ctx.workingMemory.getContextUsage();
    ctx.eventBus.dispatch(
      LoopUsageReported,
      createDomainEvent(LoopUsageReported, ctx.runId, {
        runId: ctx.runId,
        used,
        total,
      }),
    );
  };

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
      logger,
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
      await reportUsage();
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
    await reportUsage();
  }

  throw new Error('Max iterations reached');
}

function parseResponse(content: string): ReActAction {
  const cleanedContent = content
    .trim()
    .replace(/^```json\s*/, '')
    .replace(/\s*```$/, '');

  const parsed = JSON.parse(cleanedContent);

  if (
    typeof parsed.tool === 'string' &&
    parsed.tool.length > 0 &&
    parsed.input &&
    typeof parsed.input === 'object'
  ) {
    return {
      thought: parsed.thought ? String(parsed.thought) : undefined,
      tool: parsed.tool,
      input: parsed.input,
    };
  }

  throw new Error(
    'Invalid response: missing or invalid top-level `tool`/`input`',
  );
}
