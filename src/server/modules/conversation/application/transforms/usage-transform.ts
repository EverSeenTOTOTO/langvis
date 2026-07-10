import { singleton } from 'tsyringe';
import type { StreamFrame } from '@/shared/types/events';
import type {
  ConversationContext,
  ConvPhase,
  ConvTransform,
} from '@/server/modules/conversation/domain/model/conv-transform';
import { computeContextUsage } from '@/server/modules/conversation/domain/model/history-projection';
import Logger from '@/server/utils/logger';
import { convTransform } from './registry';

@singleton()
@convTransform
export class UsageTransform implements ConvTransform {
  readonly id = 'usage';
  readonly phase: ConvPhase[] = ['activated', 'turn-end'];
  private readonly logger = Logger.child({ source: 'UsageTransform' });

  async *apply(ctx: ConversationContext): AsyncGenerator<StreamFrame | void> {
    const { used, total } = computeContextUsage(
      ctx.messages.toArray(),
      ctx.config.contextSize,
    );
    this.logger.debug(
      `conversation_usage (conv ${ctx.conversationId}): used=${used} total=${total}`,
    );
    yield { type: 'conversation_usage', used, total };
  }
}
