import { describe, it, expect } from 'vitest';
import { EventEmitter } from 'events';
import type { ChildProcess } from 'child_process';

import {
  registerBackgroundTask,
  collectConversationFeed,
  drainBackgroundOutput,
} from '@/server/modules/agent/implementations/tools/Bash/background-registry';

function makeChild() {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
  };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  return child as unknown as ChildProcess;
}

function spawn(conversationId: string, command: string) {
  const child = makeChild();
  const task = registerBackgroundTask({ conversationId, command, child });
  return { task, child };
}

describe('background-registry', () => {
  it('feeds unread output once per task and marks exit state in the header', () => {
    const { task, child } = spawn('conv_feed', 'build');
    (child.stdout as EventEmitter).emit('data', Buffer.from('step 1\n'));
    child.emit('close', 0);

    const first = collectConversationFeed('conv_feed');
    expect(first).toContain('[bg_');
    expect(first).toContain('(exited with code 0)');
    expect(first).toContain('$ build');
    expect(first).toContain('step 1');
    expect(first?.startsWith('<background_tasks>')).toBe(true);

    expect(collectConversationFeed('conv_feed')).toBeNull();
    expect(task.fed).toBe(task.output.length);
  });

  it('reports a one-shot terminal notice when exit produces no unread output', () => {
    const { child } = spawn('conv_exit_notice', 'watch');
    (child.stdout as EventEmitter).emit('data', Buffer.from('starting\n'));
    collectConversationFeed('conv_exit_notice');
    child.emit('close', 1);

    const notice = collectConversationFeed('conv_exit_notice');
    expect(notice).toContain('(exited with code 1)');
    expect(notice).toContain('(no further output)');
    expect(collectConversationFeed('conv_exit_notice')).toBeNull();
  });

  it('keeps the wait cursor (consumed) independent from the feed cursor (fed)', () => {
    const { task, child } = spawn('conv_cursors', 'tail -f');
    (child.stdout as EventEmitter).emit('data', Buffer.from('chunk-a'));

    expect(drainBackgroundOutput(task)).toBe('chunk-a');
    // wait 拉走后注入路径仍能拿到全量——两条游标互不推进
    expect(collectConversationFeed('conv_cursors')).toContain('chunk-a');
    expect(collectConversationFeed('conv_cursors')).toBeNull();
  });

  it('scopes the feed to the requested conversation', () => {
    const { child } = spawn('conv_other', 'noisy');
    (child.stdout as EventEmitter).emit('data', Buffer.from('irrelevant'));
    expect(collectConversationFeed('conv_none')).toBeNull();
  });
});
