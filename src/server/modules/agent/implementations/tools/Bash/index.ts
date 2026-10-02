import { Inject } from '@nestjs/common';
import { tool } from '@/server/modules/agent/application/tools/register-tool';
import type { Logger } from '@/server/utils/logger';
import { ToolIds } from '@/shared/constants';
import type { ToolConfig } from '@/shared/types';
import type { ToolCallContext } from '@/server/modules/agent/domain/port/tool-call-context.port';
import type { RunEvent } from '@/shared/types/events';
import { Tool } from '@/server/modules/agent/domain/model/tool.base';
import { BackgroundTaskRegistry } from '@/server/modules/agent/application/service/background-task-registry';
import type { BashInput, BashOutput } from './config';
import { DirectBash, runChild, type BashBackend } from './bash-backend';
import { classifyBashCommand } from './classifier';

const DEFAULT_TIMEOUT = 60;
const MAX_TIMEOUT = 600;

/** bash HITL 表单：确认 + 超时可调 + 备注（confirmed 在首——光标落在主决策上）。 */
function bashFormSchema(suggestedTimeout: number) {
  return {
    type: 'object' as const,
    properties: {
      confirmed: {
        type: 'boolean' as const,
        title: '确认执行？',
        default: true,
      },
      timeout: {
        type: 'number' as const,
        title: '超时时间（秒）',
        description: `最大 ${MAX_TIMEOUT}s`,
        default: suggestedTimeout,
        minimum: 1,
        maximum: MAX_TIMEOUT,
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

  constructor(
    @Inject(BackgroundTaskRegistry)
    private readonly backgroundTasks: BackgroundTaskRegistry,
  ) {
    super();
  }

  describe(
    input: Record<string, unknown>,
    output?: unknown,
    error?: string,
  ): string {
    const { command } = input as unknown as BashInput;
    if (error) return `ran \`${command}\` → failed: ${error}`;
    const o = output as BashOutput | undefined;
    const status = o?.timedOut
      ? 'timed out'
      : o?.exitCode === 0
        ? 'ok'
        : `exit ${o?.exitCode ?? '?'}`;
    return `ran \`${command}\` → ${status}`;
  }

  async *call(
    ctx: ToolCallContext,
  ): AsyncGenerator<RunEvent, BashOutput, void> {
    ctx.signal.throwIfAborted();

    const { command, timeout, background, wait, kill } =
      ctx.input as unknown as BashInput;

    // ── 后台任务控制面：wait / kill 与执行面共用一次 bash 调用的入口 ──
    if (wait?.taskId) {
      const task = this.backgroundTasks.get(wait.taskId);
      if (!task || task.conversationId !== ctx.conversationId) {
        throw new Error(`background task not found: ${wait.taskId}`);
      }
      const output = this.backgroundTasks.drain(task, wait.tail);
      return {
        exitCode: 0,
        stdout: output,
        stderr: '',
        background: {
          taskId: task.taskId,
          running: task.exitCode === null,
          exitCode: task.exitCode,
        },
      };
    }
    if (kill?.taskId) {
      const task = this.backgroundTasks.get(kill.taskId);
      if (!task || task.conversationId !== ctx.conversationId) {
        throw new Error(`background task not found: ${kill.taskId}`);
      }
      this.backgroundTasks.kill(task);
      return {
        exitCode: 0,
        stdout: `killed ${task.taskId}`,
        stderr: '',
        background: { taskId: task.taskId, running: false, exitCode: null },
      };
    }
    const workDir = ctx.workDir;
    const suggestedTimeout = Math.min(
      Math.max(timeout ?? DEFAULT_TIMEOUT, 1),
      MAX_TIMEOUT,
    );

    const backend: BashBackend = new DirectBash();

    // pwd-containment：只读且在 workDir 内 → safe 直放；其余 sensitive 走授权门。
    // 子 agent（非交互）同门：命中继承 grant 直放，缺则 ensureApproved 快速失败。
    const perm = classifyBashCommand(command, workDir);
    let userTimeout: number;
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

    ctx.signal.throwIfAborted();

    const handle = backend.spawn(command, workDir);

    // 后台模式：注册即返回，不随 run abort 传播（会话级生命周期）
    if (background) {
      const task = this.backgroundTasks.register({
        conversationId: ctx.conversationId,
        command,
        child: handle.child,
      });
      return {
        exitCode: 0,
        stdout: `background task started: ${task.taskId}\nuse bash {wait:{taskId:"${task.taskId}"}} to drain output`,
        stderr: '',
        background: { taskId: task.taskId, running: true, exitCode: null },
      };
    }

    return yield* runChild(handle, {
      timeoutSec: userTimeout,
      signal: ctx.signal,
      callId: ctx.callId,
    });
  }
}
