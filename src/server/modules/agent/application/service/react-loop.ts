import { ToolIds } from '@/shared/constants';
import { Role } from '@/shared/entities/Message';
import type { RunEvent } from '@/shared/types/events';
import {
  EMPTY_RESPONSE_NUDGE,
  PARSE_ERROR_OBSERVATION_PREFIX,
  parseResponse,
  ReActStreamSplitter,
} from './react-message';
import type {
  AgentRunContext,
  ParsedAction,
  ToolExecutor,
  ToolRunResult,
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

// ── 多动作批调度：parallel 段内并发、serial 是栅栏（排干在飞行批后独自执行）──

/** 并发段驱动：各生成器事件经共享队列实时交织产出（不等最慢者），返回值按入参序收集。 */
async function* runConcurrent(
  generators: AsyncGenerator<RunEvent, ToolRunResult, void>[],
): AsyncGenerator<RunEvent, ToolRunResult[], void> {
  const queue: RunEvent[] = [];
  const results = new Array<ToolRunResult>(generators.length);
  let remaining = generators.length;
  let firstError: unknown;
  let resolve: (() => void) | undefined;
  const notify = () => {
    resolve?.();
    resolve = undefined;
  };

  const workers = Promise.all(
    generators.map(async (gen, idx) => {
      try {
        for (;;) {
          const r = await gen.next();
          if (r.done) {
            results[idx] = r.value;
            break;
          }
          queue.push(r.value);
        }
      } catch (err) {
        firstError ??= err;
      } finally {
        remaining--;
        notify();
      }
    }),
  );

  while (remaining > 0 || queue.length > 0) {
    if (queue.length === 0) {
      await new Promise<void>(r => {
        resolve = r;
      });
      continue;
    }
    yield queue.shift()!;
  }
  await workers;
  if (firstError !== undefined) throw firstError;
  return results;
}

// 按发射序过批：连续 parallel 工具并发执行；serial 工具等前序全部完成后独自执行。 返回各动作结果（发射序），Observation 由调用方按序回灌。
async function* executeBatch(
  ctx: AgentRunContext,
  actions: readonly ParsedAction[],
  runTool: ToolExecutor,
): AsyncGenerator<RunEvent, ToolRunResult[], void> {
  const isParallel = (name: string) => ctx.toolSet?.isParallel(name) ?? false;
  const results: ToolRunResult[] = [];
  let i = 0;
  while (i < actions.length) {
    ctx.signal.throwIfAborted();
    if (isParallel(actions[i]!.tool)) {
      let j = i;
      while (j < actions.length && isParallel(actions[j]!.tool)) j++;
      const segment = yield* runConcurrent(
        actions.slice(i, j).map(a => runTool(a.tool, a.input)),
      );
      results.push(...segment);
      i = j;
    } else {
      results.push(yield* runTool(actions[i]!.tool, actions[i]!.input));
      i++;
    }
  }
  return results;
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
  let emptyResponses = 0;

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
      if (!content) {
        // 空响应 nudge：追加到末尾驱动模型立即行动；连续 2 次仍空才判定模型故障
        if (++emptyResponses > 2) throw new Error('No response from model');
        ctx.messages.push({ role: Role.USER, content: EMPTY_RESPONSE_NUDGE });
        continue;
      }
      emptyResponses = 0;
      logger.debug(`ReAct origin response: ${content}`);
      ctx.messages.push({ role: Role.ASSIST, content });

      // 解析成功挂到 ctx.pendingActions 供 pre-action hook 直读。
      let actions: ParsedAction[];
      try {
        actions = parseResponse(content);
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
      ctx.pendingActions = actions;

      yield* applyHooks(ctx, 'pre-action');

      if (actions.length === 1) {
        const { tool, input } = actions[0]!;
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
      } else {
        // 多动作批：parallel 段并发、serial 栅栏；Observation 按发射序回灌（配对不变式）。
        // response_user 等控制流工具已在 parse 层禁止出现在多块响应中。
        const results = yield* executeBatch(ctx, actions, runTool);
        for (const result of results) {
          ctx.messages.push({
            role: Role.USER,
            content: `Observation: ${result.observation}\n`,
          });
        }
      }
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
