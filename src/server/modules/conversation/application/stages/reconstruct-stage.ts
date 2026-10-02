import { Inject } from '@nestjs/common';
import { Role } from '@/shared/entities/Message';
import { MESSAGE_REPOSITORY } from '@/server/modules/conversation/conversation.di-tokens';
import type { MessageRepositoryPort } from '@/server/modules/conversation/domain/port/message.repository.port';
import type {
  ContextStage,
  StageTarget,
  StageEvent,
} from '@/server/shared/context';
import {
  findLatestCompactionSummary,
  toLlmMessages,
  RECONSTRUCTED_HEAD_CHARS,
} from '@/server/modules/conversation/application/service/history-projection';
import { ModelRegistryService } from '@/server/infrastructure/model-registry.service';
import { estimateTokens } from '@/server/utils/estimateTokens';
import Logger from '@/server/utils/logger';

// 选择性重构（turn-end）：低阈、保细节、非破坏。effective 超 contextSize×reconstructThreshold 时，把 tail 内较早的长 USER 消息打
// meta.reconstructed 标记并落库——投影/折叠读取时按标记只取头部（原正文留库不改、UI 仍全文）。落库故过刷新/重启（与 agent 运行时消息不同）。
export class ReconstructStage implements ContextStage {
  readonly id = 'reconstruct';
  readonly phase = 'turn-end' as const;
  private readonly logger = Logger.child({ source: 'ReconstructStage' });

  constructor(
    @Inject(MESSAGE_REPOSITORY)
    private readonly messageRepo: MessageRepositoryPort,
    @Inject(ModelRegistryService)
    private readonly modelRegistry: ModelRegistryService,
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
    const threshold = convFold.reconstructThreshold;
    if (threshold === undefined) return;

    const history = ctx.messages;
    const { summary, index } = findLatestCompactionSummary(history);
    const tailStart = summary ? index + 1 : 0;

    // used 读 toLlmMessages（已重构者按标记截断）；本 turn 待标记的尚全量 → used 偏高触发，符合预期。
    const effective = summary
      ? [summary, ...history.slice(tailStart)]
      : history.slice(tailStart);
    const used = estimateTokens(toLlmMessages(effective));
    const limit = contextSize * threshold;
    if (used <= limit) {
      this.logger.debug(
        `below reconstruct threshold, skipped (conv ${ctx.conversationId}): used=${used} ≤ ${Math.round(limit)}`,
      );
      return;
    }

    const keepRecent = convFold.reconstructKeepRecent ?? 0;
    const lastMutable = history.length - keepRecent;
    let flagged = 0;
    // 仅打标 tail 内、近窗口之前的长 USER 消息（用户提问/正文最长；assistant 动作短不碰）。
    // 已标记 / compact 类 / 短于头部的不动。in-memory 改 meta 供同 turn 下游读，并落库过刷新/重启。
    for (let i = tailStart; i < lastMutable; i++) {
      const msg = history[i]!;
      if (msg.role !== Role.USER) continue;
      if ((msg.meta?.kind as string | undefined) === 'compact') continue;
      if (msg.meta?.reconstructed) continue; // 已重构（幂等）
      if (msg.content.length <= RECONSTRUCTED_HEAD_CHARS) continue;
      const meta = { ...(msg.meta ?? {}), reconstructed: true };
      history[i] = { ...msg, meta };
      await this.messageRepo.update(msg.id, { meta });
      flagged++;
    }

    if (flagged === 0) {
      this.logger.debug(
        `nothing to reconstruct (conv ${ctx.conversationId}): no long USER msgs in tail`,
      );
      return;
    }

    ctx.messages = history;
    const tailAfter = history.slice(tailStart);
    const afterTokens = estimateTokens(
      toLlmMessages(summary ? [summary, ...tailAfter] : tailAfter),
    );
    this.logger.info(
      `reconstructed (conv ${ctx.conversationId}): flagged ${flagged} long USER msg(s), ${used}→${afterTokens} tokens`,
      { flagged, usedBefore: used, usedAfter: afterTokens },
    );
    return;
  }
}
