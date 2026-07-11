import { singleton, inject } from 'tsyringe';
import type { StreamFrame } from '@/shared/types/events';
import type {
  ConversationContext,
  ConvPhase,
  ConvTransform,
} from '@/server/modules/conversation/domain/model/conv-transform';
import { computeContextUsage } from '@/server/modules/conversation/domain/model/history-projection';
import { ProviderService } from '@/server/libs/infrastructure/provider.service';
import Logger from '@/server/utils/logger';
import { convTransform } from './registry';

@singleton()
@convTransform
export class UsageTransform implements ConvTransform {
  readonly id = 'usage';
  readonly phase: ConvPhase[] = ['activated', 'turn-end'];
  private readonly logger = Logger.child({ source: 'UsageTransform' });

  constructor(
    @inject(ProviderService)
    private readonly providerService: ProviderService,
  ) {}

  async *apply(ctx: ConversationContext): AsyncGenerator<StreamFrame | void> {
    const total = this.providerService.resolveContextSize(ctx.runtimeConfig);
    const { used } = computeContextUsage(ctx.messages.toArray(), total);
    this.logger.debug(
      `conversation_usage (conv ${ctx.conversationId}): used=${used} total=${total}`,
    );
    yield { type: 'conversation_usage', used, total };
  }
}
