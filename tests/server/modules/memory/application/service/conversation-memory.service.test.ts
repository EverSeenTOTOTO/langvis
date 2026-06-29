import { describe, it, expect, vi } from 'vitest';
import { ConversationMemoryService } from '@/server/modules/memory/application/service/conversation-memory.service';
import type { HistoryCompactionService } from '@/server/modules/memory/application/service/history-compaction.service';
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

function mockCompaction(
  result: {
    content: string;
    startRef: string;
    usage: { used: number; total: number };
  } | null = null,
) {
  return {
    compact: vi.fn().mockResolvedValue(result),
  } as unknown as HistoryCompactionService;
}

const CONFIG = { contextSize: 8000, modelId: 'gpt-4', runtimeConfig: {} };
const signal = () => new AbortController().signal;

describe('ConversationMemoryService —— conv 的会话记忆同步端口（conversationId 索引）', () => {
  it('activate + buildContext 返回有效历史；getUsage 返回用量', async () => {
    const s = new ConversationMemoryService(mockCompaction());
    s.activate(
      'c1',
      [msg(Role.SYSTEM, 'sys'), msg(Role.USER, 'q1'), msg(Role.ASSIST, 'a1')],
      CONFIG,
    );
    const ctx = await s.buildContext('c1');
    expect(ctx.some(m => m.content === 'q1')).toBe(true);
    expect(s.getUsage('c1').total).toBe(8000);
  });

  it('append 增量反映到 buildContext', async () => {
    const s = new ConversationMemoryService(mockCompaction());
    s.activate('c1', [msg(Role.SYSTEM, 'sys')], CONFIG);
    s.append('c1', msg(Role.USER, 'q2'));
    const ctx = await s.buildContext('c1');
    expect(ctx.some(m => m.content === 'q2')).toBe(true);
  });

  it('compact 委托 fold（用持有的历史 + 配置），有结果时透传', async () => {
    const compaction = mockCompaction({
      content: 'C',
      startRef: 'm1',
      usage: { used: 1, total: 8000 },
    });
    const s = new ConversationMemoryService(compaction);
    s.activate('c1', [msg(Role.USER, 'q')], CONFIG);
    const result = await s.compact('c1', signal());
    expect(result?.content).toBe('C');
    expect(compaction.compact).toHaveBeenCalledWith(
      expect.objectContaining({
        contextSize: 8000,
        runtimeConfig: {},
        messages: expect.any(Array),
      }),
    );
  });

  it('compact 未超阈（fold 返回 null）时透传 null', async () => {
    const s = new ConversationMemoryService(mockCompaction(null));
    s.activate('c1', [msg(Role.USER, 'q')], CONFIG);
    expect(await s.compact('c1', signal())).toBeNull();
  });

  it('未 activate 时 getUsage 抛错（fail loud）', () => {
    const s = new ConversationMemoryService(mockCompaction());
    expect(() => s.getUsage('nope')).toThrow();
  });

  it('dispose 后再操作抛错（已释放）', () => {
    const s = new ConversationMemoryService(mockCompaction());
    s.activate('c1', [msg(Role.SYSTEM, 'sys')], CONFIG);
    s.dispose('c1');
    expect(() => s.getUsage('c1')).toThrow();
  });
});
