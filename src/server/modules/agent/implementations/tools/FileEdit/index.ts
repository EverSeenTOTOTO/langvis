import { tool } from '@/server/decorator/core';
import { input } from '@/server/decorator/param';
import type { Logger } from '@/server/utils/logger';
import { ToolIds } from '@/shared/constants';
import type { ToolConfig } from '@/shared/types';
import type { ToolProgress } from '@/server/modules/agent/domain/tool-call.entity';
import type { ToolCall } from '@/server/modules/agent/domain/tool-call.entity';
import { Tool } from '@/server/modules/agent/domain/tool.base';
import { WorkspaceService } from '@/server/libs/infrastructure/workspace.service';
import { inject, container } from 'tsyringe';
import type { FileEditInput, FileEditOutput } from './config';
import AskUserTool from '../AskUser';

@tool(ToolIds.FILE_EDIT)
export default class FileEditTool extends Tool<FileEditInput, FileEditOutput> {
  readonly id!: string;
  readonly config!: ToolConfig;
  protected readonly logger!: Logger;

  constructor(
    @inject(WorkspaceService) private workspaceService: WorkspaceService,
  ) {
    super();
  }

  async *call(
    @input() { path, old_string, new_string }: FileEditInput,
    toolCall: ToolCall,
  ): AsyncGenerator<ToolProgress, FileEditOutput, void> {
    toolCall.signal.throwIfAborted();

    const workDir = toolCall.workDir;

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

    const hitl = container.resolve<AskUserTool>(ToolIds.ASK_USER);
    const { submitted, data } = yield* hitl.call(
      { message, formSchema: formSchema as any },
      toolCall,
    );

    if (!submitted || !(data as Record<string, unknown>)?.confirmed) {
      throw new Error('操作已取消');
    }

    toolCall.signal.throwIfAborted();
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
    const result = output as FileEditOutput | undefined;
    if (!result) return '完成';
    return `${result.changes} 处修改`;
  }
}
