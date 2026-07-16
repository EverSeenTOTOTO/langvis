import { tool } from '@/server/decorator/tool';
import type { Logger } from '@/server/utils/logger';
import { ToolIds } from '@/shared/constants';
import type { ToolConfig } from '@/shared/types';
import type { ToolCallContext } from '@/server/modules/agent/domain/port/tool-call-context.port';
import type { RunEvent } from '@/shared/types/events';
import { Tool } from '@/server/modules/agent/domain/model/tool.base';
import { WorkspaceService } from '@/server/libs/infrastructure/workspace.service';
import { inject, container } from 'tsyringe';
import type { FileEditInput, FileEditOutput } from './config';
import AskUserTool from '../AskUser';

@tool(ToolIds.FILE_EDIT)
export default class FileEditTool extends Tool<FileEditOutput> {
  readonly id!: string;
  readonly config!: ToolConfig;
  protected readonly logger!: Logger;

  constructor(
    @inject(WorkspaceService) private workspaceService: WorkspaceService,
  ) {
    super();
  }

  async *call(
    ctx: ToolCallContext,
  ): AsyncGenerator<RunEvent, FileEditOutput, void> {
    ctx.signal.throwIfAborted();

    const { path, old_string, new_string } =
      ctx.input as unknown as FileEditInput;

    const workDir = ctx.workDir;

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

    const { submitted, data } = yield* hitl.call({
      ...ctx,
      input: { message, formSchema: formSchema as any },
    });

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
}
