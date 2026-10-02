import { ToolIds } from '@/shared/constants';
import { Role } from '@/shared/entities/Message';
import type { RunEvent } from '@/shared/types/events';
import {
  PARSE_ERROR_OBSERVATION_PREFIX,
  parseResponse,
  ReActStreamSplitter,
} from './react-message';
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
import { runStagePlan, type ContextPhase } from '@/server/shared/context';
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

/** 上下文相位（pre-llm/post-observation）：stage 阶梯先跑，残余 hooks 随后。 */
async function* applyStages(
  ctx: AgentRunContext,
  phase: ContextPhase,
): AsyncGenerator<RunEvent, void, void> {
  if (!ctx.stages) return;
  for await (const ev of runStagePlan(ctx.stages, phase, {
    kind: 'run',
    runId: ctx.runId,
    signal: ctx.signal,
    messages: ctx.messages,
    base: ctx.base,
    runtimeConfig: ctx.config.runtimeConfig,
    workDir: ctx.workDir,
    cache: ctx.cache,
  })) {
    if (ev && ev.type !== undefined) yield ev as RunEvent;
  }
}

export async function* runReactLoop(
  ctx: AgentRunContext,
  runTool: ToolExecutor,
): AsyncGenerator<RunEvent, void, void> {
  const model = ctx.config.runtimeConfig.model ?? {};

  for (;;) {
    ctx.signal.throwIfAborted();
    try {
      yield* applyStages(ctx, 'pre-llm');
      yield* applyHooks(ctx, 'pre-llm');

      // 流式消费：边流边发 thought / response_user 的 message（text_chunk），
      // 全文聚合后照旧走 parseResponse（action 解析仍在流结束进行）。
      const splitter = new ReActStreamSplitter();
      let content = '';
      for await (const delta of ctx.llm.chat(
        model.modelId,
        {
          messages: ctx.messages,
          temperature: model.temperature,
          stop: ['Observation:', 'Observation：'],
        },
        ctx.signal,
      )) {
        content += delta;
        for (const ev of splitter.push(delta)) yield ev;
      }
      for (const ev of splitter.flush()) yield ev;
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
      yield* applyStages(ctx, 'post-observation');
      yield* applyHooks(ctx, 'post-observation');
    } catch (e) {
      // hook 经 sentinel 表态：ContinueTick→下一轮，StopLoop→退出（接 loop-exit）；其余上抛。
      if (e instanceof ContinueTick) continue;
      if (e instanceof StopLoop) return yield* exitLoop(ctx);
      throw e;
    }
  }
}
