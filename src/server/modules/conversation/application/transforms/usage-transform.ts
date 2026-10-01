import { Inject } from '@nestjs/common';
import type { StreamFrame } from '@/shared/types/events';
import type {
  ConversationContext,
  ConvPhase,
  ConvTransform,
} from '@/server/modules/conversation/domain/model/conv-transform';
import {
  findLatestCompactionSummary,
  toLlmMessages,
} from '@/server/modules/conversation/application/service/history-projection';
import type { Message } from '@/shared/types/entities';
import {
  estimateTokens,
  type ContextUsage,
} from '@/server/utils/estimateTokens';
import { ProviderService } from '@/server/infrastructure/provider.service';
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

export class UsageTransform implements ConvTransform {
  readonly id = 'usage';
  readonly phase: ConvPhase[] = ['activated', 'turn-end'];
  private readonly logger = Logger.child({ source: 'UsageTransform' });

  constructor(
    @Inject(ProviderService)
    private readonly providerService: ProviderService,
  ) {}

  async *apply(ctx: ConversationContext): AsyncGenerator<StreamFrame | void> {
    const total = this.providerService.resolveContextSize(ctx.runtimeConfig);
    const { used } = computeContextUsage(ctx.messages, total);
    this.logger.debug(
      `conversation_usage (conv ${ctx.conversationId}): used=${used} total=${total}`,
    );
    yield { type: 'conversation_usage', used, total };
  }
}
