import { tool } from '@/server/decorator/tool';
import type { Logger } from '@/server/utils/logger';
import { ToolIds } from '@/shared/constants';
import type { ToolConfig } from '@/shared/types';
import type { ToolCallContext } from '@/server/modules/agent/domain/port/tool-call-context.port';
import type { RunEvent } from '@/shared/types/events';
import { Tool } from '@/server/modules/agent/domain/model/tool.base';
import type { BashInput, BashOutput } from './config';
import {
  DirectBash,
  DockerBash,
  runChild,
  type BashBackend,
} from './bash-backend';
import { classifyBashCommand } from './classifier';

const DEFAULT_TIMEOUT = 60;
const MAX_TIMEOUT = 600;

/** bash HITL 表单：超时可调 + 确认 + 备注（沿用原 schema）。 */
function bashFormSchema(suggestedTimeout: number) {
  return {
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
}

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
      // 工具侧 pwd-containment 判定：只读 + 全在 workDir 子树内 → safe 放行、不调 auth；
      // 越界 / 写 / exec / 含元字符 / 未知 → sensitive 走统一授权门（session 复用）。
      const perm = classifyBashCommand(command, workDir);
      if (perm.kind === 'safe') {
        userTimeout = suggestedTimeout;
      } else {
        const data = (yield* ctx.auth.ensureApproved(
          ctx,
          perm.action,
          perm.resource,
          {
            prompt: perm.prompt,
            formSchema: bashFormSchema(suggestedTimeout),
          },
        )) as Record<string, unknown> | undefined;

        userTimeout = Math.min(
          Math.max(Number(data?.timeout) || suggestedTimeout, 1),
          MAX_TIMEOUT,
        );
      }
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
