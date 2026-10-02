import { describe, it, expect } from 'vitest';
import { EventEmitter } from 'events';
import type { ChildProcess } from 'child_process';

import { BackgroundTaskRegistry } from '@/server/modules/agent/application/service/background-task-registry';

function makeChild() {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
  };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  return child as unknown as ChildProcess;
}

function spawn(
  registry: BackgroundTaskRegistry,
  conversationId: string,
  command: string,
) {
  const child = makeChild();
  const task = registry.register({ conversationId, command, child });
  return { task, child };
}

describe('BackgroundTaskRegistry', () => {
  it('feeds unread output once per task and marks exit state in the header', () => {
    const registry = new BackgroundTaskRegistry();
    const { task, child } = spawn(registry, 'conv_feed', 'build');
    (child.stdout as EventEmitter).emit('data', Buffer.from('step 1\n'));
    child.emit('close', 0);

    const first = registry.collectConversationFeed('conv_feed');
    expect(first).toContain('[bg_');
    expect(first).toContain('(exited with code 0)');
    expect(first).toContain('$ build');
    expect(first).toContain('step 1');
    expect(first?.startsWith('<background_tasks>')).toBe(true);

    expect(registry.collectConversationFeed('conv_feed')).toBeNull();
    expect(task.fed).toBe(task.output.length);
  });

  it('reports a one-shot terminal notice when exit produces no unread output', () => {
    const registry = new BackgroundTaskRegistry();
    const { child } = spawn(registry, 'conv_exit_notice', 'watch');
    (child.stdout as EventEmitter).emit('data', Buffer.from('starting\n'));
    registry.collectConversationFeed('conv_exit_notice');
    child.emit('close', 1);

    const notice = registry.collectConversationFeed('conv_exit_notice');
    expect(notice).toContain('(exited with code 1)');
    expect(notice).toContain('(no further output)');
    expect(registry.collectConversationFeed('conv_exit_notice')).toBeNull();
  });

  it('keeps the wait cursor (consumed) independent from the feed cursor (fed)', () => {
    const registry = new BackgroundTaskRegistry();
    const { task, child } = spawn(registry, 'conv_cursors', 'tail -f');
    (child.stdout as EventEmitter).emit('data', Buffer.from('chunk-a'));

    expect(registry.drain(task)).toBe('chunk-a');
    // wait 拉走后注入路径仍能拿到全量——两条游标互不推进
    expect(registry.collectConversationFeed('conv_cursors')).toContain(
      'chunk-a',
    );
    expect(registry.collectConversationFeed('conv_cursors')).toBeNull();
  });

  it('scopes the feed to the requested conversation', () => {
    const registry = new BackgroundTaskRegistry();
    const { child } = spawn(registry, 'conv_other', 'noisy');
    (child.stdout as EventEmitter).emit('data', Buffer.from('irrelevant'));
    expect(registry.collectConversationFeed('conv_none')).toBeNull();
  });

  it('instances are isolated——无跨实例泄漏（provider 生命周期安全）', () => {
    const a = new BackgroundTaskRegistry();
    const b = new BackgroundTaskRegistry();
    const { child } = spawn(a, 'conv_iso', 'x');
    (child.stdout as EventEmitter).emit('data', Buffer.from('data'));
    expect(b.collectConversationFeed('conv_iso')).toBeNull();
    expect(a.collectConversationFeed('conv_iso')).toContain('data');
  });
});
