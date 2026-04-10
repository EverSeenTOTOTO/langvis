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

const FLUSH_INTERVAL = 100; // 100ms
const DEFAULT_TIMEOUT = 60;
const MAX_TIMEOUT = 600;
const SIGTERM_GRACE = 5000;
const PROGRESS_LIMIT = 8 * 1024; // 8KB preview via toolProgress

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
    let lastFlushedStdout = 0;
    let lastFlushedStderr = 0;
    let progressSent = 0;
    let timedOut = false;
    let resolveExit: (code: number) => void;
    const exitPromise = new Promise<number>(resolve => (resolveExit = resolve));

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
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

    const flushOutput = (source: 'stdout' | 'stderr'): AgentEvent | null => {
      if (progressSent >= PROGRESS_LIMIT) return null;

      const output = source === 'stdout' ? stdout : stderr;
      const flushed =
        source === 'stdout' ? lastFlushedStdout : lastFlushedStderr;

      if (output.length <= flushed) return null;

      const remaining = PROGRESS_LIMIT - progressSent;
      let text = output.slice(flushed, flushed + remaining);

      if (!text) return null;

      progressSent += text.length;

      if (PROGRESS_LIMIT <= progressSent) {
        text += ' <truncated...>';
      }

      if (source === 'stdout') lastFlushedStdout = flushed + text.length;
      else lastFlushedStderr = flushed + text.length;

      return ctx.agentToolProgressEvent(this.id, { type: source, text });
    };

    try {
      while (child.exitCode === null) {
        const result = await Promise.race([
          exitPromise.then((code: number) => ({ exit: true, code })),
          new Promise<{ timeout: true }>(r =>
            setTimeout(() => r({ timeout: true }), FLUSH_INTERVAL),
          ),
        ]);

        if ('exit' in result) break;

        const event = flushOutput('stdout') ?? flushOutput('stderr');
        if (event) yield event;
      }
    } finally {
      ctx.signal.removeEventListener('abort', onAbort);
      timeoutCleanup();
      activeProcesses.delete(child);
      killProcessTree(child);
    }

    const exitCode = await exitPromise;

    // Flush remaining
    const event = flushOutput('stdout') ?? flushOutput('stderr');
    if (event) yield event;

    if (timedOut) {
      stderr += `\nProcess timed out after ${userTimeout}s and was killed.`;
    }

    return { exitCode, stdout, stderr, timedOut };
  }
}
