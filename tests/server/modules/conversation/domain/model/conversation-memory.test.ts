import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConversationMemory } from '@/server/modules/conversation/domain/model/conversation-memory';
import { Role } from '@/shared/entities/Message';
import type { Message } from '@/shared/types/entities';

// compact() 内部调用 fold；mock 掉以控制返回，避免真实 LLM 调用。
const { foldMock } = vi.hoisted(() => ({ foldMock: vi.fn() }));
vi.mock('@/server/libs/compaction/summarizer', () => ({ fold: foldMock }));

function makeMessage(
  role: Role,
  content: string,
  meta?: Record<string, unknown>,
): Message {
  return {
    id: `msg_${role}_${content}`,
    role,
    content,
    attachments: null,
    meta: meta ?? null,
    createdAt: new Date(),
    conversationId: 'conv_1',
  };
}

const RUNTIME_CONFIG = { history: { threshold: 0.8, windowSize: 10 } };
const signal = new AbortController().signal;

function createMemory(history: Message[], contextSize = 8000) {
  return new ConversationMemory({
    history,
    contextSize,
    runtimeConfig: RUNTIME_CONFIG,
  });
}

describe('ConversationMemory', () => {
  describe('constructor', () => {
    it('存储参数（contextSize 经 getContextUsage 暴露）', () => {
      const memory = createMemory([makeMessage(Role.USER, 'hello')]);
      expect(memory.getContextUsage().total).toBe(8000);
    });

    it('空历史可用', () => {
      const memory = new ConversationMemory({
        history: [],
        contextSize: 4000,
        runtimeConfig: RUNTIME_CONFIG,
      });
      expect(memory.getContextUsage().total).toBe(4000);
    });
  });

  describe('getContextUsage', () => {
    it('依据 history + contextSize + modelId 计算用量', () => {
      const memory = createMemory([
        makeMessage(Role.USER, 'Hello world'),
        makeMessage(Role.ASSIST, 'Hi there'),
      ]);
      const usage = memory.getContextUsage();
      expect(usage.total).toBe(8000);
      expect(usage.used).toBeGreaterThan(0);
    });
  });

  describe('buildContext — 过程摘要', () => {
    it('前置 processSummary 到 assistant（按 agentRunId 从 map 取、摘要在前原文在后）', async () => {
      const assistMsg = {
        ...makeMessage(Role.ASSIST, 'Here is the answer'),
        agentRunId: 'run_1',
      };
      const history = [
        makeMessage(Role.USER, 'What is example.com?'),
        assistMsg,
      ];
      const summaries = new Map([['run_1', '搜索了 example.com 并总结']]);

      const messages = await createMemory(history).buildContext(summaries);
      const assist = messages.find(m => m.role === 'assistant')!;

      expect(assist.content).toContain('搜索了 example.com 并总结');
      expect(assist.content).toContain('Here is the answer');
      expect(assist.content.indexOf('搜索')).toBeLessThan(
        assist.content.indexOf('Here is the answer'),
      );
    });

    it('无 processSummary 时 assistant 内容不变', async () => {
      const history = [
        makeMessage(Role.USER, 'hello'),
        makeMessage(Role.ASSIST, 'Hi there'),
      ];

      const messages = await createMemory(history).buildContext();
      expect(messages.find(m => m.role === 'assistant')!.content).toBe(
        'Hi there',
      );
    });
  });

  describe('buildContext — 全量与脚手架', () => {
    it('无截断：包含全部 turn（无 C）', async () => {
      const history: Message[] = [];
      for (let i = 0; i < 15; i++) {
        history.push(makeMessage(Role.USER, `q${i}`));
        history.push(makeMessage(Role.ASSIST, `a${i}`));
      }

      const messages = await createMemory(history).buildContext();
      expect(
        messages.find(m => m.content.includes('truncated')),
      ).toBeUndefined();
      expect(messages.filter(m => m.role === 'assistant')).toHaveLength(15);
    });

    it('包含 system prompt 与 context 消息', async () => {
      const history = [
        makeMessage(Role.SYSTEM, 'You are helpful'),
        makeMessage(Role.USER, 'session context', { kind: 'context' }),
        makeMessage(Role.USER, 'visible question'),
        makeMessage(Role.ASSIST, 'answer'),
      ];

      const messages = await createMemory(history).buildContext();
      expect(messages[0].role).toBe('system');
      expect(messages.find(m => m.content === 'session context')).toBeDefined();
    });
  });

  describe('buildContext — 历史压缩 (C)', () => {
    it('有 C 时：发出 C 作为前缀，丢弃 C 之前的 turn', async () => {
      const history = [
        makeMessage(Role.SYSTEM, 'sys'),
        makeMessage(Role.USER, 'old q'),
        makeMessage(Role.ASSIST, 'old a'),
        makeMessage(Role.USER, 'C summary', {
          kind: 'compact',
        }),
        makeMessage(Role.USER, 'new q'),
        makeMessage(Role.ASSIST, 'new a'),
      ];

      const messages = await createMemory(history).buildContext();
      const contents = messages.map(m => m.content);

      expect(contents).toContain('C summary');
      expect(contents).toContain('sys');
      expect(contents).toContain('new q');
      expect(contents).toContain('new a');
      // C 之前被总结的 turn 不再出现
      expect(contents).not.toContain('old q');
      expect(contents).not.toContain('old a');
    });

    it('无 C 时：保留全部 turn（向后兼容）', async () => {
      const history = [
        makeMessage(Role.USER, 'q1'),
        makeMessage(Role.ASSIST, 'a1'),
        makeMessage(Role.USER, 'q2'),
        makeMessage(Role.ASSIST, 'a2'),
      ];

      const messages = await createMemory(history).buildContext();
      expect(messages.map(m => m.content)).toEqual(
        expect.arrayContaining(['q1', 'a1', 'q2', 'a2']),
      );
    });
  });

  describe('compact — 历史层压缩 (fold)', () => {
    beforeEach(() => {
      foldMock.mockReset();
    });

    it('未超阈：返回 null，不调用 fold', async () => {
      foldMock.mockResolvedValue('irrelevant');
      const m = createMemory([makeMessage(Role.USER, 'hi')], 100_000);
      expect(await m.compact(signal)).toBeNull();
      expect(foldMock).not.toHaveBeenCalled();
    });

    it('contextSize=0：返回 null，不调用 fold', async () => {
      foldMock.mockResolvedValue('x');
      const m = createMemory([makeMessage(Role.USER, 'hi')], 0);
      expect(await m.compact(signal)).toBeNull();
      expect(foldMock).not.toHaveBeenCalled();
    });

    it('超阈：调用 fold 并返回 C 载荷，startRef 指向首条消息', async () => {
      foldMock.mockResolvedValue('compacted summary');
      const big = 'x'.repeat(2000);
      const history = [
        makeMessage(Role.USER, big),
        makeMessage(Role.USER, big),
        makeMessage(Role.USER, big),
      ];
      const m = createMemory(history, 100);

      const r = await m.compact(signal);

      expect(r).not.toBeNull();
      expect(r!.content).toBe('compacted summary');
      expect(r!.startRef).toBe(history[0]!.id);
      // 首次压缩：无既有摘要，messages 即 tail
      expect(foldMock).toHaveBeenCalledWith({
        messages: expect.any(Array),
        windowSize: 10,
        signal,
        prompt: expect.any(Object),
      });
    });

    it('tail 为空（仅有 C 无新消息）：返回 null', async () => {
      foldMock.mockResolvedValue('irrelevant');
      const m = createMemory(
        [makeMessage(Role.USER, 'only-a-summary', { kind: 'compact' })],
        100,
      );
      expect(await m.compact(signal)).toBeNull();
      expect(foldMock).not.toHaveBeenCalled();
    });
  });
});
