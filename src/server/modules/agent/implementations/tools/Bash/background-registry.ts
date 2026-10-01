import type { ChildProcess } from 'child_process';
import { randomUUID } from 'crypto';

// 会话级后台任务注册表——run 结束不杀（区别于前台 runChild 的 abort 传播）。
// 生命周期挂 conversationId；v1 查询式（wait 拉 ring buffer 增量），v2 可改推送。

export interface BackgroundTask {
  taskId: string;
  conversationId: string;
  command: string;
  child: ChildProcess;
  startedAt: number;
  /** ring buffer：全部输出（上限 256KB，超出丢头部）。 */
  output: string;
  /** 已被 wait 消费到的偏移——增量拉取游标。 */
  consumed: number;
  exitCode: number | null;
  killed: boolean;
}

const RING_LIMIT = 256 * 1024;
const tasks = new Map<string, BackgroundTask>();

function trim(task: BackgroundTask): void {
  if (task.output.length > RING_LIMIT) {
    const drop = task.output.length - RING_LIMIT;
    task.output = task.output.slice(drop);
    task.consumed = Math.max(0, task.consumed - drop);
  }
}

export function registerBackgroundTask(params: {
  conversationId: string;
  command: string;
  child: ChildProcess;
}): BackgroundTask {
  const task: BackgroundTask = {
    taskId: `bg_${randomUUID().slice(0, 8)}`,
    conversationId: params.conversationId,
    command: params.command,
    child: params.child,
    startedAt: Date.now(),
    output: '',
    consumed: 0,
    exitCode: null,
    killed: false,
  };
  tasks.set(task.taskId, task);

  task.child.stdout?.on('data', (chunk: Buffer) => {
    task.output += chunk.toString();
    trim(task);
  });
  task.child.stderr?.on('data', (chunk: Buffer) => {
    task.output += chunk.toString();
    trim(task);
  });
  task.child.on('close', code => {
    task.exitCode = code ?? -1;
  });

  return task;
}

export function getBackgroundTask(taskId: string): BackgroundTask | undefined {
  return tasks.get(taskId);
}

/** 拉取未读增量并推进游标。 */
export function drainBackgroundOutput(
  task: BackgroundTask,
  tail?: number,
): string {
  const unread = task.output.slice(task.consumed);
  task.consumed = task.output.length;
  if (tail !== undefined && tail > 0 && unread.length > tail) {
    return `<${unread.length - tail} bytes omitted>\n${unread.slice(-tail)}`;
  }
  return unread;
}

/** SIGTERM→SIGKILL 进程组（后台任务专用，不进 runChild 的 abort 链）。 */
export function killBackgroundTask(task: BackgroundTask): void {
  if (task.exitCode !== null) return;
  task.killed = true;
  try {
    if (task.child.pid) process.kill(-task.child.pid, 'SIGTERM');
  } catch {
    /* already dead */
  }
  setTimeout(() => {
    try {
      if (task.child.pid && task.child.exitCode === null) {
        process.kill(-task.child.pid, 'SIGKILL');
      }
    } catch {
      /* already dead */
    }
  }, 5000).unref();
}

/** 会话清理（dispose 时调用）——不留孤儿进程。 */
export function disposeConversationTasks(conversationId: string): void {
  for (const task of tasks.values()) {
    if (task.conversationId === conversationId) {
      killBackgroundTask(task);
      tasks.delete(task.taskId);
    }
  }
}
