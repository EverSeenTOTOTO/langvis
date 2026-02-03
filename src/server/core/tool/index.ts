import type { Logger } from '@/server/utils/logger';
import { StreamChunk, ToolConfig } from '@/shared/types';

export abstract class Tool {
  abstract readonly id: string;
  abstract readonly config: ToolConfig;

  protected abstract readonly logger: Logger;

  async call(_input: any, _signal?: AbortSignal): Promise<unknown> {
    throw new Error(
      `${this.constructor.name}: Non-streaming call not implemented.`,
    );
  }

  async streamCall(
    _input: any,
    _outputWriter: WritableStreamDefaultWriter<StreamChunk>,
    _signal?: AbortSignal,
  ): Promise<unknown> {
    throw new Error(
      `${this.constructor.name}: Streaming call not implemented.`,
    );
  }
}

export type ToolConstructor = new () => Tool;
