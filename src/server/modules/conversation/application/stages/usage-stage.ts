import { Inject } from '@nestjs/common';
import type {
  ContextStage,
  StageTarget,
  StageEvent,
} from '@/server/shared/context';
import {
  findLatestCompactionSummary,
  toLlmMessages,
} from '@/server/modules/conversation/application/service/history-projection';
import type { Message } from '@/shared/types/entities';
import {
  estimateTokens,
  type ContextUsage,
} from '@/server/utils/estimateTokens';
import { ModelRegistryService } from '@/server/infrastructure/model-registry.service';
import Logger from '@/server/utils/logger';

/** 有效历史用量：最新压缩摘要 C + 其后 turn（与 compact-transform 同口径）。 */
export function computeContextUsage(
  messages: Message[],
  contextSize: number,
): ContextUsage {
  const { summary, index } = findLatestCompactionSummary(messages);
  const tail = summary ? messages.slice(index + 1) : messages;
  const effective = summary ? [summary, ...tail] : tail;
  return {
    used: estimateTokens(toLlmMessages(effective)),
    total: contextSize,
  };
}

export class UsageStage implements ContextStage {
  readonly id = 'usage';
  readonly phase = ['activated', 'turn-end'] as const;
  private readonly logger = Logger.child({ source: 'UsageStage' });

  constructor(
    @Inject(ModelRegistryService)
    private readonly modelRegistry: ModelRegistryService,
  ) {}

  async *apply(target: StageTarget): AsyncGenerator<StageEvent, void> {
    if (target.kind !== 'conv') return;
    const ctx = target;
    const total = this.modelRegistry.resolveContextSize(ctx.runtimeConfig);
    const { used } = computeContextUsage(ctx.messages, total);
    this.logger.debug(
      `conversation_usage (conv ${ctx.conversationId}): used=${used} total=${total}`,
    );
    yield { type: 'conversation_usage', used, total };
  }
}
