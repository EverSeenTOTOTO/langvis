import { singleton } from 'tsyringe';
import type { AgentRunContext } from '@/server/modules/agent/domain/port/agent-run-context.port';
import type {
  Hook,
  HookEffect,
  HookPhase,
} from '@/server/modules/agent/domain/model/hook';
import { agentHook } from './registry';

/**
 * CompactionHook —— 把原 react-loop 内联的迭代压缩迁为 post-observation hook。
 * apply 委托 ctx.workingMemory.compact（内部自 guard：阈值/keepRecent 不动），逻辑零迁移。
 */
@singleton()
@agentHook
export class CompactionHook implements Hook {
  readonly id = 'compaction';
  readonly phase: HookPhase = 'post-observation';

  async apply(ctx: AgentRunContext): Promise<HookEffect | null> {
    const result = await ctx.workingMemory.compact(ctx.signal);
    return result.compacted
      ? { summary: 'compacted turn history', data: { usage: result.usage } }
      : null;
  }
}
