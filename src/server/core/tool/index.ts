import type { Logger } from '@/server/utils/logger';
import { ToolConfig, ToolEvent } from '@/shared/types';

export abstract class Tool<I = unknown, O = unknown> {
  abstract readonly id: string;
  abstract readonly config: ToolConfig;

  protected abstract readonly logger: Logger;

  abstract call(
    input: I,
    signal?: AbortSignal,
  ): AsyncGenerator<ToolEvent<O>, O, void>;
}

export type ToolConstructor = new (...args: any[]) => Tool;
