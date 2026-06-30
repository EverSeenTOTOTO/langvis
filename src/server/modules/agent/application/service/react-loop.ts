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

/**
 * runReactLoop —— 内联的 ReAct 循环（原 ReActAgent.call 的体）。
 * 编排：调 LLM → 解析 → 执行工具 → 观察回填。压缩/折叠都归 WorkingMemory（ctx.workingMemory，瞬态成员）。
 * loop 用量在每次 append 与压缩后自发——经 ctx.eventBus 发 LoopUsageReported（仅 runId，loop 不知 conversation）。
 * 事件（thought / process_summary）由此 yield，由 AgentRunExecutor 统一 append + 富化。
 */
export async function* runReactLoop(
  ctx: AgentRunContext,
): AsyncGenerator<RunEvent, void, void> {
  const model =
    (ctx.config.runtimeConfig as { model?: ModelConfig }).model ?? {};

  /** 自发 loop 用量（仅 runId——conversation 反查由 conv 侧负责）。 */
  const reportUsage = () => {
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

    // 按需压缩（超阈折叠较早步骤）后取本迭代上下文；压缩成功则自发用量。
    const { compacted } = await ctx.workingMemory.compact(ctx.signal);
    if (compacted) reportUsage();
    const iterMessages = await ctx.workingMemory.buildContext();
    logger.debug('ReAct LLM call iterMessages', { total: iterMessages.length });

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
    reportUsage();

    let parsed: ReActAction;
    try {
      parsed = parseResponse(content);
    } catch (error) {
      const observation = `Error parsing response: ${(error as Error)?.message ?? String(error)}`;
      ctx.workingMemory.append(Role.USER, `Observation: ${observation}`);
      reportUsage();
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
    reportUsage();
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
