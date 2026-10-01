import { Inject } from '@nestjs/common';
import { Role } from '@/shared/entities/Message';
import { MESSAGE_REPOSITORY } from '@/server/modules/conversation/conversation.di-tokens';
import type { MessageRepositoryPort } from '@/server/modules/conversation/domain/port/message.repository.port';
import type {
  ConversationContext,
  ConvPhase,
  ConvTransform,
} from '@/server/modules/conversation/domain/model/conv-transform';
import {
  findLatestCompactionSummary,
  toLlmMessages,
} from '@/server/modules/conversation/application/service/history-projection';
import { fold } from '@/server/shared/compaction';
import { Prompt } from '@/server/shared/prompt';
import { LLM_PORT } from '@/server/shared/ports/llm/llm.tokens';
import type { LlmPort } from '@/server/shared/ports/llm/llm.port';
import { ProviderService } from '@/server/shared/infrastructure/provider.service';
import { estimateTokens } from '@/server/utils/estimateTokens';
import Logger from '@/server/utils/logger';

const HISTORY_PROMPT = Prompt.empty()
  .with('Role', 'You are a conversation compactor.')
  .with(
    'Instructions',
    'Fold the history below into a concise summary, incorporating any previous summary at the start. Preserve: who, when, did what, plus key facts and open items. Keep it concise and chronological; do not fabricate.',
  )
  .with('History', '')
  .with(
    'Output',
    'Output the summary directly (no extra explanation, no Markdown headings).',
  );

// 全对话摘要（turn-end）：高阈、折叠为摘要 C、上下文趋近清空。effective 超 contextSize×threshold 时，
// tail 折叠为 role=USER/meta.kind='compact' 摘要并 append（与 ReconstructTransform 截断头部划界）。C 落库 reload-safe。
export class SummarizeTransform implements ConvTransform {
  readonly id = 'summarize';
  readonly phase: ConvPhase = 'turn-end';
  private readonly logger = Logger.child({ source: 'SummarizeTransform' });

  constructor(
    @Inject(MESSAGE_REPOSITORY)
    private readonly messageRepo: MessageRepositoryPort,
    @Inject(ProviderService)
    private readonly providerService: ProviderService,
    @Inject(LLM_PORT) private readonly llm: LlmPort,
  ) {}

  async *apply(ctx: ConversationContext): AsyncGenerator<void> {
    const contextSize = this.providerService.resolveContextSize(
      ctx.runtimeConfig,
    );
    if (!contextSize) {
      this.logger.debug(
        `context size unresolvable, skipped (conv ${ctx.conversationId})`,
      );
      return;
    }
    const compaction = ctx.runtimeConfig.history;
    if (!compaction) {
      this.logger.debug(
        `history compaction off, skipped (conv ${ctx.conversationId})`,
      );
      return;
    }

    const history = ctx.messages;
    const { summary, index } = findLatestCompactionSummary(history);
    const tail = summary ? history.slice(index + 1) : history;
    if (tail.length === 0) return;

    const effective = summary ? [summary, ...tail] : tail;
    const used = estimateTokens(toLlmMessages(effective));
    const limit = contextSize * compaction.threshold;
    if (used <= limit) {
      this.logger.debug(
        `below summarize threshold, skipped (conv ${ctx.conversationId}): used=${used} ≤ limit=${Math.round(limit)} (${contextSize} × ${(compaction.threshold * 100).toFixed(0)}%)`,
      );
      return;
    }

    this.logger.info(
      `History over summarize threshold (${used}/${contextSize}, ${(compaction.threshold * 100).toFixed(0)}%) — compacting ${tail.length} messages`,
    );

    const tailMessages = toLlmMessages(tail);
    const messages = summary
      ? [{ role: 'user' as const, content: summary.content }, ...tailMessages]
      : tailMessages;
    const content = await fold({
      llm: this.llm,
      messages,
      windowSize: compaction.windowSize,
      signal: new AbortController().signal,
      prompt: HISTORY_PROMPT,
      modelId: compaction.compactModelId ?? ctx.runtimeConfig.model?.modelId,
    });
    if (!content) {
      this.logger.warn(
        `fold returned empty, history not summarized (conv ${ctx.conversationId}): used=${used} > limit=${Math.round(limit)}`,
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
      `summarized (conv ${ctx.conversationId}): folded ${tail.length} msgs → 1 summary`,
      {
        folded: tail.length,
        usedBefore: used,
        summaryTokens: estimateTokens(toLlmMessages([compactMessage])),
      },
    );
  }
}
