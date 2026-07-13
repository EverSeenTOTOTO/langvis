import { tool } from '@/server/decorator/core';
import { container } from 'tsyringe';
import type { Logger } from '@/server/utils/logger';
import { ToolIds } from '@/shared/constants';
import type { ToolConfig } from '@/shared/types';
import type { ToolCallContext } from '@/server/modules/agent/domain/port/tool-call-context.port';
import type { RunEvent } from '@/shared/types/events';
import { Tool } from '@/server/modules/agent/domain/model/tool.base';
import type { BashInput, BashOutput } from './config';
import AskUserTool from '../AskUser';
import {
  DirectBash,
  DockerBash,
  runChild,
  type BashBackend,
} from './bash-backend';

const DEFAULT_TIMEOUT = 60;
const MAX_TIMEOUT = 600;

@tool(ToolIds.BASH)
export default class BashTool extends Tool<BashOutput> {
  readonly id!: string;
  readonly config!: ToolConfig;
  protected readonly logger!: Logger;

  async *call(
    ctx: ToolCallContext,
  ): AsyncGenerator<RunEvent, BashOutput, void> {
    ctx.signal.throwIfAborted();

    const { command, timeout } = ctx.input as unknown as BashInput;
    const workDir = ctx.workDir;
    const suggestedTimeout = Math.min(
      Math.max(timeout ?? DEFAULT_TIMEOUT, 1),
      MAX_TIMEOUT,
    );

    // backend 按交互性选：interactive → DirectBash（人工确认后在 host 执行）；
    // 非 interactive → DockerBash（沙箱即边界，无 HITL 也安全）。
    const backend: BashBackend = ctx.interactive
      ? new DirectBash()
      : new DockerBash();

    let userTimeout: number;
    if (ctx.interactive) {
      const hitl = container.resolve<AskUserTool>(ToolIds.ASK_USER);
      const message =
        `### 执行命令\n\n` +
        `\`\`\`bash\n${command}\`\`\`\n\n` +
        `**工作目录:** \`${workDir}\``;

      const formSchema = {
        type: 'object' as const,
        properties: {
          timeout: {
            type: 'number' as const,
            title: '超时时间（秒）',
            description: `最大 ${MAX_TIMEOUT}s`,
            default: suggestedTimeout,
            minimum: 1,
            maximum: MAX_TIMEOUT,
          },
          confirmed: {
            type: 'boolean' as const,
            title: '确认执行？',
            default: true,
          },
          remark: {
            type: 'string' as const,
            title: '备注',
            description: '可选，补充说明或拒绝原因',
          },
        },
        required: ['timeout', 'confirmed'],
      };

      const { submitted, data } = yield* hitl.call({
        ...ctx,
        input: { message, formSchema: formSchema as any },
      });

      if (!submitted || !(data as Record<string, unknown>)?.confirmed) {
        const remark = (data as Record<string, unknown>)?.remark;
        throw new Error(
          remark ? `用户取消了命令执行: ${remark}` : '用户取消了命令执行',
        );
      }

      userTimeout = Math.min(
        Math.max(
          Number((data as Record<string, unknown>).timeout) || suggestedTimeout,
          1,
        ),
        MAX_TIMEOUT,
      );
    } else {
      userTimeout = suggestedTimeout;
    }

    ctx.signal.throwIfAborted();

    return yield* runChild(backend.spawn(command, workDir), {
      timeoutSec: userTimeout,
      signal: ctx.signal,
      callId: ctx.callId,
    });
  }
}
