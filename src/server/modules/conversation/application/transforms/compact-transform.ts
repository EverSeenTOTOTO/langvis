import { singleton, inject } from 'tsyringe';
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
} from '@/server/modules/conversation/domain/model/history-projection';
import type { HistoryCompactionConfig } from '@/server/modules/conversation/application/service/history-config.fragment';
import { fold } from '@/server/libs/compaction';
import { Prompt } from '@/server/libs/prompt';
import { estimateTokens } from '@/server/utils/estimateTokens';
import Logger from '@/server/utils/logger';
import { convTransform } from './registry';

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

@singleton()
@convTransform
export class CompactTransform implements ConvTransform {
  readonly id = 'compact';
  readonly phase: ConvPhase = 'turn-end';
  private readonly logger = Logger.child({ source: 'CompactTransform' });

  constructor(
    @inject(MESSAGE_REPOSITORY)
    private readonly messageRepo: MessageRepositoryPort,
  ) {}

  async *apply(ctx: ConversationContext): AsyncGenerator<void> {
    const { contextSize, runtimeConfig } = ctx.config;
    if (!contextSize) return;
    const compaction = (runtimeConfig as { history: HistoryCompactionConfig })
      .history;

    const history = ctx.messages.toArray();
    const { summary, index } = findLatestCompactionSummary(history);
    const tail = summary ? history.slice(index + 1) : history;
    if (tail.length === 0) return;

    const effective = summary ? [summary, ...tail] : tail;
    const used = estimateTokens(toLlmMessages(effective));
    if (used <= contextSize * compaction.threshold) return;

    this.logger.info(
      `History over threshold (${used}/${contextSize}, ${(compaction.threshold * 100).toFixed(0)}%) — compacting ${tail.length} messages`,
    );

    const tailMessages = toLlmMessages(tail);
    const messages = summary
      ? [{ role: 'user' as const, content: summary.content }, ...tailMessages]
      : tailMessages;
    const content = await fold({
      messages,
      windowSize: compaction.windowSize,
      signal: new AbortController().signal,
      prompt: HISTORY_PROMPT,
    });
    if (!content) return;

    const startRef = summary?.id ?? history[0]?.id ?? '';
    const [compactMessage] = await this.messageRepo.batchCreate(
      ctx.conversationId,
      [
        {
          role: Role.USER,
          content,
          meta: { kind: 'compact', startRef },
          createdAt: new Date(),
        },
      ],
    );
    ctx.messages = ctx.messages.append(compactMessage);
    this.logger.info(
      `compacted (conv ${ctx.conversationId}): ${history.length}→${ctx.messages.length} msgs`,
    );
  }
}
