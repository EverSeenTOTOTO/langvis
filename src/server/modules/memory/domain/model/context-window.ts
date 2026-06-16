import type { LlmMessage } from '@/shared/types/entities';
import { estimateTokens } from '@/server/utils/estimateTokens';
import type { ContextUsage } from './memory.types';

export class ContextWindow {
  readonly messages: LlmMessage[];
  readonly maxSize: number;
  readonly modelId: string;

  constructor(messages: LlmMessage[], maxSize: number, modelId: string) {
    this.messages = messages;
    this.maxSize = maxSize;
    this.modelId = modelId;
  }

  get usage(): ContextUsage {
    return {
      used: estimateTokens(this.messages, this.modelId),
      total: this.maxSize,
    };
  }

  get isOverThreshold(): boolean {
    return this.usage.used > this.maxSize * 0.8;
  }
}
