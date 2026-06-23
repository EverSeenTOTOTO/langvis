import type { Message } from '@/shared/types/entities';
import type { MemoryPort } from '../../domain/port/memory.port';
import { SlidingWindowMemory } from './sliding-window.memory';
import { ReActMemory } from './react.memory';

export type MemoryType = 'slide_window_memory' | 'react_memory';

/**
 * MemoryFactory — 策略选择器。
 *
 * 根据 memoryType 配置产出对应的 Memory 实例。
 * 每个实例是 per-run 的（持有自己的 history + config）。
 * 无 DI 依赖，纯工厂。
 */
export class MemoryFactory {
  create(params: {
    history: Message[];
    systemPrompt?: string;
    contextSize: number;
    modelId: string;
    memoryType: MemoryType;
    windowSize?: number;
  }): MemoryPort {
    const windowSize = params.windowSize ?? 10;

    switch (params.memoryType) {
      case 'react_memory':
        return new ReActMemory(params);
      case 'slide_window_memory':
        return new SlidingWindowMemory({ ...params, windowSize });
      default:
        return new SlidingWindowMemory({ ...params, windowSize });
    }
  }
}
