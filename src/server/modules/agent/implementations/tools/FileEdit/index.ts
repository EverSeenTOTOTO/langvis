import { Inject } from '@nestjs/common';
import { tool } from '@/server/modules/agent/application/tools/register-tool';
import type { Logger } from '@/server/utils/logger';
import { ToolIds } from '@/shared/constants';
import type { ToolConfig } from '@/shared/types';
import type { ToolCallContext } from '@/server/modules/agent/domain/port/tool-call-context.port';
import type { RunEvent } from '@/shared/types/events';
import { Tool } from '@/server/modules/agent/domain/model/tool.base';
import {
  AUTHORIZATION_PORT,
  type AuthorizationPort,
} from '@/server/modules/agent/domain/port/authorization.port';
import { WorkspaceService } from '@/server/infrastructure/workspace/workspace.service';
import type { FileEditInput, FileEditOutput } from './config';

@tool(ToolIds.FILE_EDIT)
export default class FileEditTool extends Tool<FileEditOutput> {
  readonly id!: string;
  readonly config!: ToolConfig;
  protected readonly logger!: Logger;

  constructor(
    @Inject(WorkspaceService) private workspaceService: WorkspaceService,
    @Inject(AUTHORIZATION_PORT) private auth: AuthorizationPort,
  ) {
    super();
  }

  describe(
    input: Record<string, unknown>,
    output?: unknown,
    error?: string,
  ): string {
    const { path } = input as { path?: string };
    const changes = (output as FileEditOutput | undefined)?.changes;
    if (error) return `edited ${path} → failed: ${error}`;
    return `edited ${path} (${changes ?? 0} replacement${changes === 1 ? '' : 's'})`;
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
        remark: {
          type: 'string' as const,
          title: '备注',
          description: '可选，拒绝原因',
        },
      },
      required: ['confirmed'],
    };

    // 走统一授权门：approvalMode 感知（yolo 直放/auto 写类确认/default 现状），
    // 确认后落 grant——同路径二次编辑不再问。
    yield* this.auth.ensureApproved(ctx, 'edit-path', path, {
      prompt: message,
      formSchema,
    });

    ctx.signal.throwIfAborted();
    const result = await this.workspaceService.editFile(
      path,
      old_string,
      new_string,
      workDir,
    );
    return {
      path,
      changes: result.changes,
      oldString: old_string,
      newString: new_string,
    };
  }
}
