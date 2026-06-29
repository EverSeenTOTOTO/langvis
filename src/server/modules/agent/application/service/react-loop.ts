import { readConfigFragment } from '@/server/libs/config/config-fragment';
import { ToolIds } from '@/shared/constants';
import { Role } from '@/shared/entities/Message';
import type { ModelConfig } from '@/shared/types';
import type { RunEvent } from '@/shared/types/events';
import type { AgentRunContext } from '@/server/modules/agent/domain/port/agent-run-context.port';
import { winstonLogger } from '@/server/utils/logger';

const logger = winstonLogger.child({ source: 'ReactLoop' });

const MAX_ITERATIONS = Number.MAX_SAFE_INTEGER;

type ReActAction = {
  thought?: string;
  tool: string;
  input: Record<string, unknown>;
};

/**
 * runReactLoop —— 内联的 ReAct 推理-行动-观察循环（原 ReActAgent.call 的体）。
 *
 * loop 对 memory 完全机械：每轮迭代开头「申请」上下文（ctx.loopMemory.requestContext —— memory
 * 内部按需压缩，loop 不感知压缩时机），结束后「记录」本次结果（record）。过程摘要折叠
 * （response_user 时）亦经端口。压缩/折叠/记忆维护都是 memory 的事情——本函数只做编排：
 * 调 LLM → 解析 → 执行工具 → 观察回填。事件（thought / process_summary）由此 yield，由
 * AgentRunExecutor 统一 append + 富化。loop 不持任何 memory 模型，不知 conversation。
 */
export async function* runReactLoop(
  ctx: AgentRunContext,
): AsyncGenerator<RunEvent, void, void> {
  const model = readConfigFragment<ModelConfig>(
    'model',
    ctx.config.runtimeConfig,
  );

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    ctx.signal.throwIfAborted();

    // 申请本迭代上下文（memory 内部按需压缩后返回）。
    const iterMessages = await ctx.loopMemory.requestContext(
      ctx.runId,
      ctx.signal,
    );
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

    ctx.loopMemory.record(ctx.runId, Role.ASSIST, content);

    let parsed: ReActAction;
    try {
      parsed = parseResponse(content);
    } catch (error) {
      const observation = `Error parsing response: ${(error as Error)?.message ?? String(error)}`;
      ctx.loopMemory.record(
        ctx.runId,
        Role.USER,
        `Observation: ${observation}`,
      );
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
      const summary = await ctx.loopMemory.summarizeProcess(
        ctx.runId,
        ctx.signal,
      );
      if (summary) yield { type: 'process_summary', summary };
      return;
    }

    ctx.loopMemory.record(
      ctx.runId,
      Role.USER,
      `Observation: ${observation}\n`,
    );
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
