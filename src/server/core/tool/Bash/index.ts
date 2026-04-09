import { spawn, type ChildProcess } from 'child_process';
import { tool } from '@/server/decorator/core';
import { input } from '@/server/decorator/param';
import type { Logger } from '@/server/utils/logger';
import { ToolIds } from '@/shared/constants';
import { AgentEvent, ToolConfig } from '@/shared/types';
import { Tool } from '..';
import { ExecutionContext } from '../../ExecutionContext';
import { TraceContext } from '../../TraceContext';
import { WorkspaceService } from '../../../service/WorkspaceService';
import { createTimeoutController } from '@/server/utils/abort';
import { inject } from 'tsyringe';
import { container } from 'tsyringe';
import type { BashInput, BashOutput } from './config';
import HumanInTheLoopTool from '../HumanInTheLoop';

const MAX_OUTPUT = 1024 * 1024; // 1MB per stream
const FLUSH_INTERVAL = 100; // 100ms
const DEFAULT_TIMEOUT = 60;
const MAX_TIMEOUT = 600;
const SIGTERM_GRACE = 5000;

const activeProcesses = new Set<ChildProcess>();

function registerProcessCleanup(): void {
  const cleanup = () => {
    for (const child of activeProcesses) {
      try {
        if (child.pid) process.kill(-child.pid, 'SIGKILL');
      } catch {
        /* process may already be dead */
      }
    }
    activeProcesses.clear();
  };
  process.on('exit', cleanup);
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
}

function killProcessTree(child: ChildProcess): void {
  activeProcesses.delete(child);
  if (!child.pid || child.exitCode !== null) return;
  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    /* process may already be dead */
  }
  setTimeout(() => {
    try {
      if (child.pid && child.exitCode === null) {
        process.kill(-child.pid, 'SIGKILL');
      }
    } catch {
      /* process may already be dead */
    }
  }, SIGTERM_GRACE).unref();
}

@tool(ToolIds.BASH)
export default class BashTool extends Tool<BashInput, BashOutput> {
  readonly id!: string;
  readonly config!: ToolConfig;
  protected readonly logger!: Logger;

  private cleanupRegistered = false;

  constructor(
    @inject(WorkspaceService) private workspaceService: WorkspaceService,
  ) {
    super();
  }

  private ensureCleanupRegistered(): void {
    if (!this.cleanupRegistered) {
      registerProcessCleanup();
      this.cleanupRegistered = true;
    }
  }

  async *call(
    @input() { command, timeout }: BashInput,
    ctx: ExecutionContext,
  ): AsyncGenerator<AgentEvent, BashOutput, void> {
    ctx.signal.throwIfAborted();
    this.ensureCleanupRegistered();

    const conversationId = TraceContext.getOrFail().conversationId!;
    const workDir = await this.workspaceService.getWorkDir(conversationId);
    const suggestedTimeout = Math.min(
      Math.max(timeout ?? DEFAULT_TIMEOUT, 1),
      MAX_TIMEOUT,
    );

    const hitl = container.resolve<HumanInTheLoopTool>(ToolIds.ASK_USER);
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

    const { submitted, data } = yield* hitl.call(
      { message, formSchema: formSchema as any },
      ctx,
    );

    if (!submitted || !(data as Record<string, unknown>)?.confirmed) {
      const remark = (data as Record<string, unknown>).remark;
      throw new Error(
        remark ? `用户取消了命令执行: ${remark}` : '用户取消了命令执行',
      );
    }

    const userTimeout = Math.min(
      Math.max(
        Number((data as Record<string, unknown>).timeout) || suggestedTimeout,
        1,
      ),
      MAX_TIMEOUT,
    );

    ctx.signal.throwIfAborted();

    const child = spawn(command, {
      shell: true,
      cwd: workDir,
      detached: true,
      env: { ...process.env, TERM: 'dumb' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    activeProcesses.add(child);

    let stdout = '';
    let stderr = '';
    let stdoutBuffer = '';
    let stderrBuffer = '';
    let timedOut = false;
    let resolveExit: (code: number) => void;
    const exitPromise = new Promise<number>(resolve => (resolveExit = resolve));

    child.stdout.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      if (stdout.length < MAX_OUTPUT) stdout += text;
      stdoutBuffer += text;
    });

    child.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      if (stderr.length < MAX_OUTPUT) stderr += text;
      stderrBuffer += text;
    });

    child.on('close', code => resolveExit(code ?? -1));
    child.on('error', err => {
      stderr += err.message;
      resolveExit(-1);
    });

    const [timeoutController, timeoutCleanup] = createTimeoutController(
      userTimeout * 1000,
      ctx.signal,
    );

    const onAbort = () => killProcessTree(child);
    ctx.signal.addEventListener('abort', onAbort, { once: true });

    timeoutController.signal.addEventListener('abort', () => {
      timedOut = true;
      killProcessTree(child);
    });

    try {
      // Flush loop: yield buffered output at intervals until process exits
      while (child.exitCode === null) {
        const result = await Promise.race([
          exitPromise.then((code: number) => ({ exit: true, code })),
          new Promise<{ timeout: true }>(r =>
            setTimeout(() => r({ timeout: true }), FLUSH_INTERVAL),
          ),
        ]);

        if ('exit' in result) break;

        if (stdoutBuffer) {
          yield ctx.agentToolProgressEvent(this.id, {
            type: 'stdout',
            text: stdoutBuffer,
          });
          stdoutBuffer = '';
        }
        if (stderrBuffer) {
          yield ctx.agentToolProgressEvent(this.id, {
            type: 'stderr',
            text: stderrBuffer,
          });
          stderrBuffer = '';
        }
      }
    } finally {
      ctx.signal.removeEventListener('abort', onAbort);
      timeoutCleanup();
      activeProcesses.delete(child);
      killProcessTree(child);
    }

    const exitCode = await exitPromise;

    // Flush remaining
    if (stdoutBuffer) {
      yield ctx.agentToolProgressEvent(this.id, {
        type: 'stdout',
        text: stdoutBuffer,
      });
    }
    if (stderrBuffer) {
      yield ctx.agentToolProgressEvent(this.id, {
        type: 'stderr',
        text: stderrBuffer,
      });
    }

    if (timedOut) {
      stderr += `\nProcess timed out after ${userTimeout}s and was killed.`;
    }

    return { exitCode, stdout, stderr, timedOut };
  }
}
