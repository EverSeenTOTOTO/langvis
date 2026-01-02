import type { Logger } from '@/server/utils/logger';
import { StreamChunk, ToolConfig } from '@/shared/types';

/* eslint-disable @typescript-eslint/no-unused-vars */
export abstract class Tool {
  abstract readonly id: string;
  abstract readonly config: ToolConfig;
  readonly type = 'tool';

  protected abstract readonly logger: Logger;

  async call(_input: Record<string, any>): Promise<unknown> {
    throw new Error(
      `${this.constructor.name}: Non-streaming call not implemented.`,
    );
  }

  async streamCall(
    _input: Record<string, any>,
    _outputStream: WritableStream<StreamChunk>,
  ): Promise<unknown> {
    throw new Error(
      `${this.constructor.name}: Streaming call not implemented.`,
    );
  }
}

export type ToolConstructor = new () => Tool;
