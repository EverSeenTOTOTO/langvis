import type { LlmMessage, Message, MessageKind } from '@/shared/types/entities';
import { Role } from '@/shared/entities/Message';
import type { ContextUsage } from './memory.types';
import type { ContextPort } from '../port/context.port';
import { measureUsage } from '../service/measure-usage';
import { findLatestCompactionSummary } from '../service/compaction-summary.util';

/**
 * ConversationMemory — 持久历史层（与瞬态的 WorkingMemory 共享 ContextPort、地位对等）。
 *
 * ConversationMemory 维护 historyMessages（持久、运行期只读）；
 * WorkingMemory 维护 iterMessages（瞬态、loop 内增长并自压缩）。
 *
 * 有效历史 = [最新压缩摘要 C, 其后 turn]（无 C 时为全部）；每条 assistant 消息前置其
 * meta.processSummary（loop-exit 折叠产物，用户不可见、LLM 可见）。不做硬截断。
 */
export class ConversationMemory implements ContextPort {
  protected readonly history: Message[];
  protected readonly contextSize: number;
  protected readonly modelId: string;

  constructor(params: {
    history: Message[];
    contextSize: number;
    modelId: string;
  }) {
    this.history = params.history;
    this.contextSize = params.contextSize;
    this.modelId = params.modelId;
  }

  async buildContext(): Promise<LlmMessage[]> {
    const messages: LlmMessage[] = [];

    // 脚手架：system + 会话上下文（meta.kind === 'context'），始终发出。
    for (const msg of this.history) {
      if (msg.role === Role.SYSTEM) {
        messages.push({ role: 'system', content: msg.content });
      } else if (
        msg.role === Role.USER &&
        (msg.meta?.kind as MessageKind | undefined) === 'context'
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

  getContextUsage(): ContextUsage {
    const { summary, tail } = this.getEffectiveTurns();
    const effective = summary ? [summary, ...tail] : tail;
    return measureUsage(
      effective as unknown as LlmMessage[],
      this.modelId,
      this.contextSize,
    );
  }

  /**
   * 有效历史 = 最新压缩摘要 C + 其后的 turn（无 C 时为全部消息）。
   * 被 buildContext 与 getContextUsage 共用，保证"用量"与"实际发给 LLM 的内容"口径一致。
   */
  protected getEffectiveTurns(): { summary: Message | null; tail: Message[] } {
    const { summary, index } = findLatestCompactionSummary(this.history);
    const tail = summary ? this.history.slice(index + 1) : this.history;
    return { summary, tail };
  }

  protected groupIntoTurns(messages: Message[]): Message[][] {
    const turns: Message[][] = [];
    let current: Message[] = [];

    for (const msg of messages) {
      if (msg.role === Role.SYSTEM) continue;
      // 任何带 meta.kind 的都是脚手架（context/compact），非对话 turn。
      if (msg.meta?.kind) continue;

      current.push(msg);

      if (msg.role === Role.ASSIST) {
        turns.push(current);
        current = [];
      }
    }

    if (current.length > 0) {
      turns.push(current);
    }

    return turns;
  }
}
