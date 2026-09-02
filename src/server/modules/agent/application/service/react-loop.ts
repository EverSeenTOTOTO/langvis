import { ToolIds } from '@/shared/constants';
import { Role } from '@/shared/entities/Message';
import type { RunEvent } from '@/shared/types/events';
import { PARSE_ERROR_OBSERVATION_PREFIX, parseResponse } from './react-message';
import type {
  AgentRunContext,
  ParsedAction,
  ToolExecutor,
} from '@/server/modules/agent/domain/port/agent-run-context.port';
import type { HookPhase } from '@/server/modules/agent/domain/model/hook';
import {
  ContinueTick,
  StopLoop,
} from '@/server/modules/agent/domain/model/hook';
import Logger from '@/server/utils/logger';
import { traceGen } from '@/server/otel';

const logger = Logger.child({ source: 'ReactLoop' });

async function* applyHooks(
  ctx: AgentRunContext,
  phase: HookPhase,
): AsyncGenerator<RunEvent, void, void> {
  const hooks = ctx.hooks?.forPhase(phase);
  if (!hooks) return;
  for (const hook of hooks) {
    yield* hook.apply(ctx);
  }
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
    try {
      yield* applyHooks(ctx, 'pre-llm');

      const content = await ctx.llm.chatContent(
        model.modelId,
        {
          messages: ctx.messages,
          temperature: model.temperature,
          stop: ['Observation:', 'Observation：'],
        },
        ctx.signal,
      );
      if (!content) throw new Error('No response from model');
      logger.debug(`ReAct origin response: ${content}`);
      ctx.messages.push({ role: Role.ASSIST, content });

      // 解析成功挂到 ctx.pendingAction 供 pre-action hook 直读。
      let parsed: ParsedAction;
      try {
        parsed = parseResponse(content);
      } catch (error) {
        ctx.messages.push({
          role: Role.USER,
          content:
            PARSE_ERROR_OBSERVATION_PREFIX +
            ((error as Error)?.message ?? String(error)),
        });
        yield* applyHooks(ctx, 'post-observation');
        continue;
      }
      ctx.pendingAction = parsed;

      yield* applyHooks(ctx, 'pre-action');

      const { tool, input } = parsed;
      if (parsed.thought) yield { type: 'thought', content: parsed.thought };

      const result = yield* traceGen(
        'tool.call',
        { 'tool.name': tool },
        toolSpan =>
          (async function* () {
            const r = yield* runTool(tool, input);
            toolSpan.setAttribute('tool.status', r.status);
            return r;
          })(),
      );
      // response_user 成功（completed=delivered）才退出；失败不退出，回灌 error 供模型重试。
      if (tool === ToolIds.RESPONSE_USER && result.status === 'completed')
        return yield* exitLoop(ctx);

      ctx.messages.push({
        role: Role.USER,
        content: `Observation: ${result.observation}\n`,
      });
      yield* applyHooks(ctx, 'post-observation');
    } catch (e) {
      // hook 经 sentinel 表态：ContinueTick→下一轮，StopLoop→退出（接 loop-exit）；其余上抛。
      if (e instanceof ContinueTick) continue;
      if (e instanceof StopLoop) return yield* exitLoop(ctx);
      throw e;
    }
  }
}
