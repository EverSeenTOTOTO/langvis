import { tool } from '@/server/decorator/core';
import { inject, container } from 'tsyringe';
import type { Logger } from '@/server/utils/logger';
import { ToolIds } from '@/shared/constants';
import type { ToolConfig } from '@/shared/types';
import type { ToolCallContext } from '@/server/modules/agent/domain/port/tool-call-context.port';
import type { RunEvent } from '@/shared/types/events';
import { Tool } from '@/server/modules/agent/domain/model/tool.base';
import type { BashInput, BashOutput } from './config';
import AskUserTool from '../AskUser';
import { SANDBOX_BACKEND } from '@/server/modules/agent/agent.di-tokens';
import { runChild, type BashBackend } from './bash-backend';

const DEFAULT_TIMEOUT = 60;
const MAX_TIMEOUT = 600;

/**
 * 非交互式 run（子 agent）下静默通过的只读命令。保守策略：仅放行单条、首词命中白名单、
 * 且不含控制/重定向/替换运算符的命令；含管道、重定向、&& 等一律拒绝（避免误放行副作用命令）。
 * `find`（-exec/-delete 风险）、`git`（子命令相关）故意不放行。
 *
 * 仅在 DirectBash（dev，无沙箱）+ 非交互式时生效；DockerBash 下沙箱即边界，allowlist 失效。
 */
const READONLY_COMMANDS = new Set([
  'rg',
  'fd',
  'lsd',
  'ls',
  'bat',
  'cat',
  'head',
  'tail',
  'pwd',
  'wc',
  'which',
  'test',
  'grep',
  'echo',
  'stat',
  'du',
  'df',
  'file',
  'env',
  'printenv',
  'basename',
  'dirname',
  'realpath',
]);

const SHELL_CONTROL_RE = /[|;<>&`]|\$\(/;

function isReadonlyCommand(command: string): boolean {
  if (SHELL_CONTROL_RE.test(command)) return false;
  const first = command.trim().split(/\s+/)[0];
  return !!first && READONLY_COMMANDS.has(first);
}
export { isReadonlyCommand };

@tool(ToolIds.BASH)
export default class BashTool extends Tool<BashOutput> {
  readonly id!: string;
  readonly config!: ToolConfig;
  protected readonly logger!: Logger;

  private readonly backend: BashBackend;

  constructor(@inject(SANDBOX_BACKEND) backend: BashBackend) {
    super();
    this.backend = backend;
  }

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

    let userTimeout: number;
    if (ctx.interactive) {
      const hitl = container.resolve<AskUserTool>(ToolIds.ASK_USER);
      const message =
        `### 执行命令\n\n` +
        `\`\`\`bash\n${command}\n\`\`\`\n\n` +
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
    } else if (
      this.backend.requiresReadonlyGuard &&
      !isReadonlyCommand(command)
    ) {
      // dev + 非交互式：无沙箱又无人类，allowlist 是唯一兜底（弱守卫，仅防意外）。
      throw new Error(
        `Non-interactive run (sub-agent): command requires confirmation but HITL is unavailable. ` +
          `Only single read-only commands are auto-approved; compound or mutating commands are refused. ` +
          `In prod this runs sandboxed instead.`,
      );
    } else {
      userTimeout = suggestedTimeout;
    }

    ctx.signal.throwIfAborted();

    return yield* runChild(this.backend.spawn(command, workDir), {
      timeoutSec: userTimeout,
      signal: ctx.signal,
      callId: ctx.callId,
    });
  }
}
