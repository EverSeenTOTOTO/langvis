import { Inject } from '@nestjs/common';
import type { AgentRunContext } from '@/server/modules/agent/domain/port/agent-run-context.port';
import type { Hook, HookPhase } from '@/server/modules/agent/domain/model/hook';
import type { RunEvent } from '@/shared/types/events';
import { estimateTokens } from '@/server/utils/estimateTokens';
import { ModelRegistryService } from '@/server/infrastructure/model-registry.service';
import Logger from '@/server/utils/logger';

export class LoopUsageHook implements Hook {
  readonly id = 'loop-usage';
  readonly phase: HookPhase = 'post-observation';
  private readonly logger = Logger.child({ source: 'LoopUsageHook' });

  constructor(
    @Inject(ModelRegistryService)
    private readonly modelRegistry: ModelRegistryService,
  ) {}

  async *apply(ctx: AgentRunContext): AsyncGenerator<RunEvent, void> {
    const used = estimateTokens(ctx.messages);
    const total = this.modelRegistry.resolveContextSize(
      ctx.config.runtimeConfig,
    );
    this.logger.debug(
      `loop_usage (run ${ctx.runId}): used=${used} total=${total}`,
    );
    yield { type: 'loop_usage', used, total };
    return;
  }
}
