import { tool } from '@/server/decorator/core';
import { input } from '@/server/decorator/param';
import type { Logger } from '@/server/utils/logger';
import { ToolIds } from '@/shared/constants';
import { AgentEvent, ToolConfig } from '@/shared/types';
import { Tool } from '..';
import { ExecutionContext } from '../../ExecutionContext';
import { TraceContext } from '../../TraceContext';
import { WorkspaceService } from '../../../service/WorkspaceService';
import { inject } from 'tsyringe';
import type { ReadFileInput, ReadFileOutput } from './config';

@tool(ToolIds.FILE_READ)
export default class ReadFileTool extends Tool<ReadFileInput, ReadFileOutput> {
  readonly id!: string;
  readonly config!: ToolConfig;
  protected readonly logger!: Logger;

  constructor(
    @inject(WorkspaceService) private workspaceService: WorkspaceService,
  ) {
    super();
  }

  async *call(
    @input() { path }: ReadFileInput,
    ctx: ExecutionContext,
  ): AsyncGenerator<AgentEvent, ReadFileOutput, void> {
    ctx.signal.throwIfAborted();

    const conversationId = TraceContext.getOrFail().conversationId!;
    const workDir = await this.workspaceService.getWorkDir(conversationId);

    const result = await this.workspaceService.readFile(path, workDir);

    if (!result) {
      throw new Error(`File not found: ${path}`);
    }

    return { content: result.content, size: result.size, path };
  }
}
