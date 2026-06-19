import type { Logger } from '@/server/utils/logger';
import type { ToolConfig } from '@/shared/types';
import type { ToolCallContext } from '../port/tool-call-context.port';
import type { RunEvent } from '@/shared/types/events';

export abstract class Tool<O = unknown> {
  abstract readonly id: string;
  abstract readonly config: ToolConfig;

  protected abstract readonly logger: Logger;

  abstract call(ctx: ToolCallContext): AsyncGenerator<RunEvent, O, void>;

  async dispose(): Promise<void> {}
}

export type ToolConstructor = new (...args: any[]) => Tool;
