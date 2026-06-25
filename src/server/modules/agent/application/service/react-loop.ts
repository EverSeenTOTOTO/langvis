import { WorkingMemory } from '@/server/modules/memory/domain/model/working-memory';
import { readCompactionConfig } from '@/server/modules/memory/domain/service/compaction-config';
import { ToolIds } from '@/shared/constants';
import { Role } from '@/shared/entities/Message';
import type { LlmMessage } from '@/shared/types/entities';
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

interface ReActRuntimeConfig {
  model?: {
    modelId?: string;
    temperature?: number;
  };
}

/**
 * runReactLoop —— 内联的 ReAct 推理-行动-观察循环（原 ReActAgent.call 的体）。
 *
 * 迭代上下文由 WorkingMemory 拥有（瞬态层）：每步 append、超阈自压缩、退出折叠过程摘要；
 * 本函数只做编排：调 LLM → 解析 → 执行工具 → 观察回填。事件（thought / context_usage /
 * process_summary）由此 yield，由 AgentRunExecutor 统一 append + 富化。
 */
export async function* runReactLoop(
  ctx: AgentRunContext,
): AsyncGenerator<RunEvent, void, void> {
  const cfg = ctx.config.runtimeConfig as ReActRuntimeConfig;
  const cc = readCompactionConfig(ctx.config.runtimeConfig);
  const modelId = cfg.model?.modelId ?? '';

  const working = new WorkingMemory({
    seed: buildIterMessages(await ctx.memory.buildContext()),
    contextSize: ctx.config.contextSize,
    modelId,
    llm: ctx.llm,
    compaction: cc,
    logger,
  });

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    ctx.signal.throwIfAborted();

    if (cc.enabled) {
      const result = await working.compact(ctx.signal);
      if (result.compacted) {
        yield {
          type: 'context_usage',
          used: result.usage.used,
          total: result.usage.total,
          reason: 'context_compressed',
        };
      }
    }

    const iterMessages = await working.buildContext();
    logger.debug('ReAct LLM call iterMessages', {
      total: iterMessages.length,
      loopActions: iterMessages.length - working.baseLength,
      iterMessages,
    });

    const content = await ctx.llm.chatContent(
      {
        messages: iterMessages,
        temperature: cfg.model?.temperature,
        stop: ['Observation:', 'Observation：'],
      },
      ctx.signal,
      logger,
    );

    if (!content) {
      throw new Error('No response from model');
    }

    working.append(Role.ASSIST, content);

    let parsed: ReActAction;
    try {
      parsed = parseResponse(content);
    } catch (error) {
      const observation = `Error parsing response: ${(error as Error)?.message ?? String(error)}`;
      working.append(Role.USER, `Observation: ${observation}`);
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
      const summary = await working.foldProcessSummary(ctx.signal);
      if (summary) yield { type: 'process_summary', summary };
      return;
    }

    working.append(Role.USER, `Observation: ${observation}\n`);
  }

  throw new Error('Max iterations reached');
}

/** 历史回复重建为扁平的 response_user 调用，保持与当前输出格式一致。 */
function buildIterMessages(
  messages: Array<{ role: string; content: string }>,
): LlmMessage[] {
  return messages.map(msg => {
    if (msg.role !== 'assistant') {
      return { role: msg.role as 'user' | 'system', content: msg.content };
    }
    return {
      role: 'assistant' as const,
      content: JSON.stringify({
        tool: ToolIds.RESPONSE_USER,
        input: { message: msg.content },
      }),
    };
  });
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
