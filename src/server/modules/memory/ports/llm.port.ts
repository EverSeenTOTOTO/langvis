import type { LlmMessage } from '@/shared/types/entities';

export interface LlmPort {
  chatContent(
    modelId: string | undefined,
    options: {
      messages: LlmMessage[];
      temperature?: number;
      top_p?: number;
    },
    signal: AbortSignal,
  ): Promise<string>;
}
