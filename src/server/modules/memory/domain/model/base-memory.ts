import type { LlmMessage, Message } from '@/shared/types/entities';
import { Role } from '@/shared/entities/Message';
import type { ContextUsage } from './memory.types';
import type { MemoryPort } from '../port/memory.port';
import { ContextWindow } from './context-window';

/**
 * BaseMemory — 所有 Memory 策略的抽象基类。
 *
 * 持有 history / contextSize / modelId，
 * 提供 getContextUsage() 默认实现和 groupIntoTurns() 共享方法。
 * 每个策略只需实现 buildContext()。
 */
export abstract class BaseMemory implements MemoryPort {
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

  abstract buildContext(): Promise<LlmMessage[]>;

  getContextUsage(): ContextUsage {
    const window = new ContextWindow(
      this.history as unknown as LlmMessage[],
      this.contextSize,
      this.modelId,
    );
    return window.usage;
  }

  protected groupIntoTurns(messages: Message[]): Message[][] {
    const turns: Message[][] = [];
    let current: Message[] = [];

    for (const msg of messages) {
      if (msg.role === Role.SYSTEM) continue;
      if (msg.role === Role.USER && msg.meta?.hidden) continue;

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
