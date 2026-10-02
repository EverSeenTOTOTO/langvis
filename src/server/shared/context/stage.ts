// 统一上下文管理框架：一套 Stage 接口横跨 run 域（瞬态工作集）与会话域（持久记忆）。
// 相位决定作用域；注册序即相位内执行序，也是确定性分层阶梯（免费→桩化→LLM 折叠→fail-fast）。

import type { LlmMessage } from '@/shared/types/entities';
import type {
  StreamFrame,
  RunEvent,
  EnrichedEvent,
} from '@/shared/types/events';
import type { Message } from '@/shared/types/entities';
import type { ConversationConfig } from '@/server/modules/conversation/domain/config';

export type ContextPhase =
  | 'activated'
  | 'turn-start'
  | 'pre-llm'
  | 'post-observation'
  | 'turn-end';

/** run 域目标：AgentRunContext 的窄结构视图（瞬态工作集，run 结束即弃）。 */
export interface RunTarget {
  kind: 'run';
  runId: string;
  signal: AbortSignal;
  /** run 工作集（seed + loop 动作），stage 原地修改。 */
  messages: LlmMessage[];
  /** seed 边界：[0,base) 为前缀，[base,len) 为 loop 动作。 */
  base: number;
  runtimeConfig: ConversationConfig;
  /** 工作目录（桩化落盘相对根）。 */
  workDir: string;
  /** 大内容落盘端口（trim 桩化用），结构兼容 CachePort。 */
  cache: {
    offload(
      workDir: string,
      value: unknown,
      hint?: string,
    ): Promise<{
      $cached: string;
      $size: number;
      $preview?: string;
      $label?: string;
    }>;
  };
}

/** turn-end per-call run 语境（不入 ctx，多 run 并发会互相覆盖）。 */
export interface RunCtx {
  messageId: string;
  runId: string;
}

/** 会话域目标：ConversationSession 的窄结构视图（持久记忆，改动落库）。 */
export interface ConvTarget {
  kind: 'conv';
  conversationId: string;
  /** 会话消息（持久），stage 原地修改并自行落库。 */
  messages: Message[];
  runtimeConfig: ConversationConfig;
  /** 本 run 的累积事件流（turn-end 烘过程摘要用）。 */
  getRunEvents(messageId: string): readonly EnrichedEvent[] | undefined;
  /** turn-end 透传；其余相位 undefined。 */
  runCtx?: RunCtx;
}

export type StageTarget = RunTarget | ConvTarget;

export type StageEvent = RunEvent | StreamFrame | void;

export interface ContextStage {
  readonly id: string;
  /** 一个 stage 可注册在多个相位（如 usage @ activated + turn-end）。 */
  readonly phase: ContextPhase | readonly ContextPhase[];
  apply(target: StageTarget): AsyncGenerator<StageEvent, void>;
}

const PHASES: readonly ContextPhase[] = [
  'activated',
  'turn-start',
  'pre-llm',
  'post-observation',
  'turn-end',
];

export class StagePlan {
  private readonly byPhase: Readonly<
    Record<ContextPhase, readonly ContextStage[]>
  >;

  constructor(stages: readonly ContextStage[] = []) {
    const inPhase = (s: ContextStage, p: ContextPhase) =>
      Array.isArray(s.phase) ? s.phase.includes(p) : s.phase === p;
    this.byPhase = Object.fromEntries(
      PHASES.map(p => [p, stages.filter(s => inPhase(s, p))]),
    ) as unknown as Record<ContextPhase, readonly ContextStage[]>;
  }

  forPhase(phase: ContextPhase): readonly ContextStage[] {
    return this.byPhase[phase];
  }
}

/** 按相位跑 stage（注册序）；LoopSignal 冒泡给调用方（run 域 fail-fast 用）。 */
export async function* runStagePlan(
  plan: StagePlan,
  phase: ContextPhase,
  target: StageTarget,
): AsyncGenerator<StageEvent, void> {
  for (const stage of plan.forPhase(phase)) {
    yield* stage.apply(target);
  }
}

/** 会话域便捷入口：把 ConversationContext 适配为 ConvTarget 跑指定相位。 */
export async function* convStages(
  ctx: {
    conversationId: string;
    messages: Message[];
    runtimeConfig: ConversationConfig;
    stages: StagePlan;
    getRunEvents(messageId: string): readonly EnrichedEvent[] | undefined;
  },
  phase: 'activated' | 'turn-start' | 'turn-end',
  runCtx?: RunCtx,
): AsyncGenerator<StreamFrame | void, void> {
  const { stages, getRunEvents, ...rest } = ctx;
  const events: (StreamFrame | void)[] = [];
  for await (const ev of runStagePlan(stages, phase, {
    kind: 'conv',
    ...rest,
    getRunEvents,
    runCtx,
  })) {
    // conv 域 stage 契约只产 StreamFrame;RunEvent 形态属 run 域,防御性丢弃
    if (ev && ev.type !== undefined && isStreamFrame(ev)) events.push(ev);
  }
  for (const ev of events) yield ev;
}

function isStreamFrame(ev: RunEvent | StreamFrame): ev is StreamFrame {
  return [
    'connected',
    'session_replaced',
    'run_events',
    'run_view',
    'queued',
    'conversation_usage',
    'loop_usage',
  ].includes(ev.type);
}
