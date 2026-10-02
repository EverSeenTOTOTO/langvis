import { Inject } from '@nestjs/common';
import { Role } from '@/shared/entities/Message';
import { MESSAGE_REPOSITORY } from '@/server/modules/conversation/conversation.di-tokens';
import type { MessageRepositoryPort } from '@/server/modules/conversation/domain/port/message.repository.port';
import type {
  ContextStage,
  StageTarget,
  StageEvent,
} from '@/server/shared/context';
import { SNAPSHOT_PROMPT } from '@/server/shared/context';
import {
  findLatestCompactionSummary,
  toLlmMessages,
} from '@/server/modules/conversation/application/service/history-projection';
import { fold } from '@/server/shared/compaction';
import { LLM_PORT } from '@/server/infrastructure/llm/llm.tokens';
import type { LlmPort } from '@/server/infrastructure/llm/llm.port';
import { ModelRegistryService } from '@/server/infrastructure/model-registry.service';
import { estimateTokens } from '@/server/utils/estimateTokens';
import Logger from '@/server/utils/logger';

/** 会话域折叠（turn-end）：高阈、折叠为结构化快照 C、上下文趋近清空。与 reconstruct 截头划界。C 落库 reload-safe。 */
export class ConvFoldStage implements ContextStage {
  readonly id = 'conv-fold';
  readonly phase = 'turn-end' as const;
  private readonly logger = Logger.child({ source: 'ConvFoldStage' });

  constructor(
    @Inject(MESSAGE_REPOSITORY)
    private readonly messageRepo: MessageRepositoryPort,
    @Inject(ModelRegistryService)
    private readonly modelRegistry: ModelRegistryService,
    @Inject(LLM_PORT) private readonly llm: LlmPort,
  ) {}

  async *apply(target: StageTarget): AsyncGenerator<StageEvent, void> {
    if (target.kind !== 'conv') return;
    const ctx = target;

    const contextSize = this.modelRegistry.resolveContextSize(
      ctx.runtimeConfig,
    );
    if (!contextSize) {
      this.logger.debug(
        `context size unresolvable, skipped (conv ${ctx.conversationId})`,
      );
      return;
    }
    const convFold = ctx.runtimeConfig.context?.convFold;
    if (!convFold) {
      this.logger.debug(`convFold off, skipped (conv ${ctx.conversationId})`);
      return;
    }

    const history = ctx.messages;
    const { summary, index } = findLatestCompactionSummary(history);
    const tail = summary ? history.slice(index + 1) : history;
    if (tail.length === 0) return;

    const effective = summary ? [summary, ...tail] : tail;
    const used = estimateTokens(toLlmMessages(effective));
    const limit = contextSize * convFold.threshold;
    if (used <= limit) {
      this.logger.debug(
        `below fold threshold, skipped (conv ${ctx.conversationId}): used=${used} ≤ limit=${Math.round(limit)}`,
      );
      return;
    }

    this.logger.info(
      `History over fold threshold (${used}/${contextSize}) — folding ${tail.length} messages`,
    );

    const tailMessages = toLlmMessages(tail);
    const messages = summary
      ? [{ role: 'user' as const, content: summary.content }, ...tailMessages]
      : tailMessages;
    const content = await fold({
      llm: this.llm,
      messages,
      windowSize: convFold.windowSize,
      signal: new AbortController().signal,
      prompt: SNAPSHOT_PROMPT,
      modelId: convFold.modelId ?? ctx.runtimeConfig.model?.modelId,
    });
    if (!content) {
      this.logger.warn(
        `fold returned empty, history not folded (conv ${ctx.conversationId}): used=${used} > limit=${Math.round(limit)}`,
      );
      return;
    }

    const [compactMessage] = await this.messageRepo.batchCreate(
      ctx.conversationId,
      [
        {
          role: Role.USER,
          content,
          meta: { kind: 'compact' },
          createdAt: new Date(),
        },
      ],
    );
    ctx.messages.push(compactMessage);
    this.logger.info(
      `folded (conv ${ctx.conversationId}): ${tail.length} msgs → 1 snapshot`,
      {
        folded: tail.length,
        usedBefore: used,
        summaryTokens: estimateTokens(toLlmMessages([compactMessage])),
      },
    );
  }
}
