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
import type { WriteFileInput, WriteFileOutput } from './config';
import HumanInTheLoopTool from '../HumanInTheLoop';
import { container } from 'tsyringe';

@tool(ToolIds.FILE_WRITE)
export default class WriteFileTool extends Tool<
  WriteFileInput,
  WriteFileOutput
> {
  readonly id!: string;
  readonly config!: ToolConfig;
  protected readonly logger!: Logger;

  constructor(
    @inject(WorkspaceService) private workspaceService: WorkspaceService,
  ) {
    super();
  }

  async *call(
    @input() { path, content }: WriteFileInput,
    ctx: ExecutionContext,
  ): AsyncGenerator<AgentEvent, WriteFileOutput, void> {
    ctx.signal.throwIfAborted();

    const conversationId = TraceContext.getOrFail().conversationId!;
    const workDir = await this.workspaceService.getWorkDir(conversationId);

    const size = Buffer.byteLength(content, 'utf-8');
    const preview =
      content.length > 2000
        ? `${content.slice(0, 1000)}\n\n... (truncated) ...\n\n${content.slice(-1000)}`
        : content;

    const message =
      `### 创建新文件\n` +
      `**路径:** \`${path}\`\n` +
      `**大小:** ${size} 字节\n\n` +
      `<details>\n<summary>文件内容预览</summary>\n\n` +
      `\`\`\`\n${preview}\n\`\`\`\n` +
      `</details>`;

    const formSchema = {
      type: 'object' as const,
      properties: {
        confirmed: { type: 'boolean' as const, title: '确认创建？' },
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
    const writeResult = await this.workspaceService.writeFile(
      path,
      content,
      workDir,
    );
    return { path, size: writeResult.size };
  }
}
