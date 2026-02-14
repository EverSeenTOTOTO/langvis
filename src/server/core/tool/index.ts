import type { Logger } from '@/server/utils/logger';
import { ToolConfig, ToolEvent } from '@/shared/types';
import { ExecutionContext } from '../context';

export abstract class Tool<I = unknown, O = unknown> {
  abstract readonly id: string;
  abstract readonly config: ToolConfig;

  protected abstract readonly logger: Logger;

  abstract call(
    input: I,
    ctx: ExecutionContext,
  ): AsyncGenerator<ToolEvent, O, void>;
}

export type ToolConstructor = new (...args: any[]) => Tool;
