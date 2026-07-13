import {
  spawn,
  execFileSync,
  type ChildProcess,
  type SpawnOptions,
} from 'child_process';
import { readFileSync, unlinkSync } from 'fs';
import os from 'node:os';
import path from 'node:path';
import { singleton } from 'tsyringe';
import { generateId } from '@/shared/utils';
import { createTimeoutController } from '@/server/utils/abort';
import {
  lifecycleHook,
  type LifecycleHook,
} from '@/server/decorator/lifecycle';
import Logger from '@/server/utils/logger';
import type { RunEvent } from '@/shared/types/events';
import type { BashOutput } from './config';

const logger = Logger.child({ source: 'BashBackend' });

const FLUSH_INTERVAL = 100;
const PROGRESS_LIMIT = 8 * 1024; // preview cap streamed via tool_progress
const SIGTERM_GRACE = 5000;
const DOCKER_IMAGE =
  process.env.LANGVIS_BASH_IMAGE || 'langvis-bash-sandbox:latest';

const activeProcesses = new Set<ChildProcess>();
let cleanupRegistered = false;

function ensureProcessCleanup(): void {
  if (cleanupRegistered) return;
  const cleanup = (): void => {
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
  cleanupRegistered = true;
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

export interface ChildHandle {
  child: ChildProcess;
  /** Idempotent: SIGTERM→SIGKILL the process (+ container, for Docker). */
  kill: () => void;
}

export interface BashBackend {
  spawn(command: string, workDir: string): ChildHandle;
}

const COMMON_SPAWN_OPTS: SpawnOptions = {
  detached: true,
  env: { ...process.env, TERM: 'dumb' },
  stdio: ['pipe', 'pipe', 'pipe'],
};

/** interactive 态：直接在 host 上执行（shell 模式，cwd=workDir）。
 *  Bash 工具仅在 ctx.interactive 时选它——人工确认后才在 host 跑。 */
export class DirectBash implements BashBackend {
  spawn(command: string, workDir: string): ChildHandle {
    const child = spawn(command, {
      ...COMMON_SPAWN_OPTS,
      shell: true,
      cwd: workDir,
    });
    return { child, kill: () => killProcessTree(child) };
  }
}

/** prod：在 Docker 沙箱内执行。host workDir 以同路径 bind-mount，与 host 工具共享 scratch 目录；
 *  `--network=none` 断网、资源上限防 DoS、`--user` 保证写出的文件属主为 host 用户。
 *  kill 走 `--cidfile` + `docker kill`——group-kill 在 SIGKILL 时会孤立容器。 */
export class DockerBash implements BashBackend {
  spawn(command: string, workDir: string): ChildHandle {
    const cidFile = path.join(os.tmpdir(), `bash-cid-${generateId('')}`);
    const child = spawn(
      'docker',
      [
        'run',
        '--rm',
        '--init',
        '--sig-proxy=true',
        '--network=none',
        '--pids-limit=128',
        '--memory=512m',
        `--user=${process.getuid!()}:${process.getgid!()}`,
        `--cidfile=${cidFile}`,
        '-v',
        `${workDir}:${workDir}`,
        '-w',
        workDir,
        DOCKER_IMAGE,
        'sh',
        '-c',
        command,
      ],
      COMMON_SPAWN_OPTS,
    );
    const kill = (): void => {
      try {
        const cid = readFileSync(cidFile, 'utf8').trim();
        if (cid)
          execFileSync('docker', ['kill', cid], {
            stdio: 'ignore',
            timeout: 5000,
          });
      } catch {
        /* cidfile 尚未写出 / docker kill 失败 / 容器已退出 */
      }
      killProcessTree(child);
      try {
        unlinkSync(cidFile);
      } catch {
        /* already gone */
      }
    };
    return { child, kill };
  }
}

interface RunChildOpts {
  timeoutSec: number;
  signal: AbortSignal;
  callId: string;
}

/**
 * 共享执行核：流式收集 stdout/stderr（按 PROGRESS_LIMIT 截断式 flush 为 tool_progress）、
 * 超时/abort 即 kill、退出后汇总。DirectBash / DockerBash 仅 spawn + kill 不同，此处复用。
 */
export async function* runChild(
  handle: ChildHandle,
  opts: RunChildOpts,
): AsyncGenerator<RunEvent, BashOutput, void> {
  ensureProcessCleanup();
  const { child, kill } = handle;
  const { timeoutSec, signal, callId } = opts;
  activeProcesses.add(child);

  let stdout = '';
  let stderr = '';
  let lastFlushedStdout = 0;
  let lastFlushedStderr = 0;
  let progressSent = 0;
  let timedOut = false;
  let resolveExit: (code: number) => void;
  const exitPromise = new Promise<number>(resolve => (resolveExit = resolve));

  child.stdout!.on('data', (chunk: Buffer) => {
    stdout += chunk.toString();
  });
  child.stderr!.on('data', (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  child.on('close', code => resolveExit(code ?? -1));
  child.on('error', err => {
    stderr += err.message;
    resolveExit(-1);
  });

  const [timeoutController, timeoutCleanup] = createTimeoutController(
    timeoutSec * 1000,
    signal,
  );
  const onAbort = (): void => kill();
  signal.addEventListener('abort', onAbort, { once: true });
  timeoutController.signal.addEventListener('abort', () => {
    timedOut = true;
    kill();
  });

  const flushOutput = (
    source: 'stdout' | 'stderr',
  ): { type: 'stdout' | 'stderr'; text: string } | null => {
    if (progressSent >= PROGRESS_LIMIT) return null;

    const output = source === 'stdout' ? stdout : stderr;
    const flushed = source === 'stdout' ? lastFlushedStdout : lastFlushedStderr;
    if (output.length <= flushed) return null;

    const remaining = PROGRESS_LIMIT - progressSent;
    let text = output.slice(flushed, flushed + remaining);
    if (!text) return null;

    progressSent += text.length;
    if (PROGRESS_LIMIT <= progressSent) text += ' <truncated...>';
    if (source === 'stdout') lastFlushedStdout = flushed + text.length;
    else lastFlushedStderr = flushed + text.length;
    return { type: source, text };
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
      if (event) yield { type: 'tool_progress', callId, data: event };
    }
  } finally {
    signal.removeEventListener('abort', onAbort);
    timeoutCleanup();
    activeProcesses.delete(child);
    kill();
  }

  const exitCode = await exitPromise;

  const event = flushOutput('stdout') ?? flushOutput('stderr');
  if (event) yield { type: 'tool_progress', callId, data: event };

  if (timedOut)
    stderr += `\nProcess timed out after ${timeoutSec}s and was killed.`;

  return { exitCode, stdout, stderr, timedOut };
}

/** docker 守护进程是否可用（启动探测用，同步）。 */
function dockerAvailable(): boolean {
  try {
    execFileSync('docker', ['info'], {
      stdio: 'ignore',
      timeout: 5000,
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * 启动期探测：非交互式 Bash 以 Docker 沙箱为硬边界，docker 守护或沙箱镜像缺失时仅警告——
 * spawn（`docker run`）会自然 fail-fast。dev 同样需要 docker（非交互 = 子 agent / eval）。
 * 经 @lifecycleHook 自注册，bootAll() 解析调用；随 bash-backend 被 agent.module 导入而生效。
 */
@singleton()
@lifecycleHook
export class BashSandboxProbe implements LifecycleHook {
  onBoot(): void {
    if (!dockerAvailable()) {
      logger.warn(
        'Docker daemon unavailable — non-interactive Bash will fail at spawn. Install/start docker.',
      );
      return;
    }
    try {
      execFileSync('docker', ['image', 'inspect', DOCKER_IMAGE], {
        stdio: 'ignore',
      });
    } catch {
      logger.warn(
        `Bash sandbox image "${DOCKER_IMAGE}" not found — run: make sandbox-image`,
      );
    }
  }
}
