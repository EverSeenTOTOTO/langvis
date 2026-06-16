import type { LlmMessage, Message } from '@/shared/types/entities';
import type { ContextUsage } from '../model/memory.types';

export interface MemoryPort {
  summarize(
    history: Message[],
    options: {
      windowSize?: number;
      systemPrompt?: string;
      memoryType?: 'slide_window' | 'react';
      modelId?: string;
    },
  ): Promise<LlmMessage[]>;
  estimateUsage(
    messages: LlmMessage[],
    maxSize: number,
    modelId: string,
  ): ContextUsage;
}
