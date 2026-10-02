import { Injectable } from '@nestjs/common';
import type { ChildProcess } from 'child_process';
import { randomUUID } from 'crypto';

// 会话级后台任务注册表——run 结束不杀（区别于前台 runChild 的 abort 传播）。
// 生命周期挂 conversationId；会话清理走 ConversationDisposed 领域事件，conv 不直接触达。

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
  /** 已被 run 起注入消费到的偏移——LLM 上下文游标。 */
  fed: number;
  exitCode: number | null;
  killed: boolean;
  /** 退出终态是否已注入过（无尾部输出的退出也要让模型知道已结束）。 */
  exitNoticed: boolean;
}

const RING_LIMIT = 256 * 1024;

function trim(task: BackgroundTask): void {
  if (task.output.length > RING_LIMIT) {
    const drop = task.output.length - RING_LIMIT;
    task.output = task.output.slice(drop);
    task.consumed = Math.max(0, task.consumed - drop);
    task.fed = Math.max(0, task.fed - drop);
  }
}

@Injectable()
export class BackgroundTaskRegistry {
  private readonly tasks = new Map<string, BackgroundTask>();

  register(params: {
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
      fed: 0,
      exitCode: null,
      killed: false,
      exitNoticed: false,
    };
    this.tasks.set(task.taskId, task);

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

  get(taskId: string): BackgroundTask | undefined {
    return this.tasks.get(taskId);
  }

  /** 收集会话后台任务的未读输出（run 起注入 LLM 上下文），推进 fed 游标。 */
  collectConversationFeed(conversationId: string): string | null {
    const sections: string[] = [];
    for (const task of this.tasks.values()) {
      if (task.conversationId !== conversationId) continue;
      const unread = task.output.slice(task.fed);
      const state =
        task.exitCode === null
          ? 'still running'
          : task.killed
            ? 'killed'
            : `exited with code ${task.exitCode}`;
      if (unread) {
        task.fed = task.output.length;
        if (task.exitCode !== null) task.exitNoticed = true;
        sections.push(
          `[${task.taskId}] (${state}) $ ${task.command}\n${unread}`,
        );
      } else if (task.exitCode !== null && !task.exitNoticed) {
        task.exitNoticed = true;
        sections.push(
          `[${task.taskId}] (${state}) $ ${task.command}\n(no further output)`,
        );
      }
    }
    if (sections.length === 0) return null;
    return `<background_tasks>\n${sections.join('\n')}\n</background_tasks>`;
  }

  /** 拉取未读增量并推进游标。 */
  drain(task: BackgroundTask, tail?: number): string {
    const unread = task.output.slice(task.consumed);
    task.consumed = task.output.length;
    if (tail !== undefined && tail > 0 && unread.length > tail) {
      return `<${unread.length - tail} bytes omitted>\n${unread.slice(-tail)}`;
    }
    return unread;
  }

  /** SIGTERM→SIGKILL 进程组（后台任务专用，不进 runChild 的 abort 链）。 */
  kill(task: BackgroundTask): void {
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

  /** 会话清理（ConversationDisposed 事件消费）——不留孤儿进程。 */
  disposeConversation(conversationId: string): void {
    for (const task of this.tasks.values()) {
      if (task.conversationId === conversationId) {
        this.kill(task);
        this.tasks.delete(task.taskId);
      }
    }
  }
}
