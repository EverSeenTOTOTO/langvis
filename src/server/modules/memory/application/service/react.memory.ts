import type { LlmMessage } from '@/shared/types/entities';
import { Role } from '@/shared/entities/Message';
import { ConversationMemory } from '../../domain/model/conversation-memory';
import { COMPACTION_SUMMARY_KIND } from '../../domain/service/compaction-summary.util';

/**
 * ReActMemory — 带历史压缩 (C) 与过程摘要的上下文策略。
 *
 * 有效历史 = [最新 C, 其后 turn]（无 C 时为全部）；每条 assistant 消息前置其
 * meta.processSummary（loop-exit 折叠产物，用户不可见、LLM 可见）。不做硬截断。
 */
export class ReActMemory extends ConversationMemory {
  async buildContext(): Promise<LlmMessage[]> {
    const messages: LlmMessage[] = [];

    // 脚手架：system + hidden 非压缩摘要（session-context 等），始终发出。
    for (const msg of this.history) {
      if (msg.role === Role.SYSTEM) {
        messages.push({ role: 'system', content: msg.content });
      } else if (
        msg.role === Role.USER &&
        msg.meta?.hidden &&
        msg.meta?.kind !== COMPACTION_SUMMARY_KIND
      ) {
        messages.push({ role: 'user', content: msg.content });
      }
    }

    // 最新压缩摘要 C（若有）作为有效历史前缀，替代被它总结的早期 turn。
    const { summary, tail } = this.getEffectiveTurns();
    if (summary) {
      messages.push({ role: 'user', content: summary.content });
    }

    // C 之后的 turn（无 C 时为全部 turn）。
    for (const turn of this.groupIntoTurns(tail)) {
      for (const msg of turn) {
        let content = msg.content;

        if (msg.role === Role.ASSIST) {
          const processSummary = msg.meta?.processSummary;
          if (typeof processSummary === 'string' && processSummary) {
            content = `${processSummary}\n\n${content}`;
          }
        }

        messages.push({ role: msg.role as LlmMessage['role'], content });
      }
    }

    return messages;
  }
}
