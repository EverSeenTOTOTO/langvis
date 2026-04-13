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
import type { EditFileInput, EditFileOutput } from './config';
import HumanInTheLoopTool from '../HumanInTheLoop';
import { container } from 'tsyringe';

@tool(ToolIds.FILE_EDIT)
export default class EditFileTool extends Tool<EditFileInput, EditFileOutput> {
  readonly id!: string;
  readonly config!: ToolConfig;
  protected readonly logger!: Logger;

  constructor(
    @inject(WorkspaceService) private workspaceService: WorkspaceService,
  ) {
    super();
  }

  async *call(
    @input() { path, old_string, new_string }: EditFileInput,
    ctx: ExecutionContext,
  ): AsyncGenerator<AgentEvent, EditFileOutput, void> {
    ctx.signal.throwIfAborted();

    const conversationId = TraceContext.getOrFail().conversationId!;
    const workDir = await this.workspaceService.getWorkDir(conversationId);

    const removed = old_string
      .split('\n')
      .map(l => `- ${l}`)
      .join('\n');
    const added = new_string
      .split('\n')
      .map(l => `+ ${l}`)
      .join('\n');
    const diff = `\`\`\`diff\n${removed}\n${added}\n\`\`\``;

    const message = `### 编辑文件\n**路径:** \`${path}\`\n\n${diff}`;

    const formSchema = {
      type: 'object' as const,
      properties: {
        confirmed: { type: 'boolean' as const, title: '确认修改？' },
      },
      required: ['confirmed'],
    };

    const hitl = container.resolve<HumanInTheLoopTool>(ToolIds.ASK_USER);
    const { submitted, data } = yield* hitl.call(
      { message, formSchema: formSchema as any },
      ctx,
    );

    if (!submitted || !(data as Record<string, unknown>)?.confirmed) {
      throw new Error('操作已取消');
    }

    ctx.signal.throwIfAborted();
    const result = await this.workspaceService.editFile(
      path,
      old_string,
      new_string,
      workDir,
    );
    return { path, changes: result.changes };
  }

  override summarizeArgs(args: Record<string, unknown>): string {
    const path = typeof args.path === 'string' ? args.path : '';
    return `(${path})`;
  }

  override summarizeOutput(output: unknown): string {
    const result = output as EditFileOutput | undefined;
    if (!result) return '完成';
    return `${result.changes} 处修改`;
  }
}
