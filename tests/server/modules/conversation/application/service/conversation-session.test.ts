import { describe, it, expect } from 'vitest';
import { ConversationSession } from '@/server/modules/conversation/application/service/conversation-session';
import { Role } from '@/shared/entities/Message';
import type { Message } from '@/shared/types/entities';

function msg(
  role: Role,
  content: string,
  meta?: Record<string, unknown>,
): Message {
  return {
    id: `m_${role}_${content}`,
    role,
    content,
    attachments: null,
    meta: meta ?? null,
    createdAt: new Date(),
    conversationId: 'c1',
  };
}

const CONFIG = { contextSize: 8000, modelId: 'gpt-4', runtimeConfig: {} };
const makeSession = (id = 'c1') =>
  new ConversationSession(id, 30_000, () => {});

describe('ConversationSession —— 会话记忆成员（ConversationMemory 宿主）', () => {
  it('activateMemory + getMemory.buildContext 返回有效历史；getContextUsage 用量', async () => {
    const s = makeSession();
    s.activateMemory(
      [msg(Role.SYSTEM, 'sys'), msg(Role.USER, 'q1'), msg(Role.ASSIST, 'a1')],
      CONFIG,
    );
    const ctx = await s.getMemory().buildContext();
    expect(ctx.some(m => m.content === 'q1')).toBe(true);
    expect(s.getMemory().getContextUsage().total).toBe(8000);
  });

  it('append 经 getMemory 反映到 buildContext', async () => {
    const s = makeSession();
    s.activateMemory([msg(Role.SYSTEM, 'sys')], CONFIG);
    s.getMemory().append(msg(Role.USER, 'q2'));
    const ctx = await s.getMemory().buildContext();
    expect(ctx.some(m => m.content === 'q2')).toBe(true);
  });

  it('未 activateMemory 时 getMemory 抛错（fail loud）', () => {
    const s = makeSession();
    expect(() => s.getMemory()).toThrow();
  });

  it('dispose 后 getMemory 抛错（记忆随会话释放）', () => {
    const s = makeSession();
    s.activateMemory([msg(Role.SYSTEM, 'sys')], CONFIG);
    s.dispose();
    expect(() => s.getMemory()).toThrow();
  });
});
