import { describe, it, expect } from 'vitest';
import { ConversationMemory } from '@/server/modules/memory/domain/model/conversation-memory';
import { Role } from '@/shared/entities/Message';
import type { Message } from '@/shared/types/entities';

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

function createMemory(history: Message[]) {
  return new ConversationMemory({
    history,
    contextSize: 8000,
    modelId: 'openai:gpt-4',
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
        modelId: '',
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

  describe('groupIntoTurns', () => {
    it('按 assistant 消息分组 turn', () => {
      const history = [
        makeMessage(Role.USER, 'question 1'),
        makeMessage(Role.ASSIST, 'answer 1'),
        makeMessage(Role.USER, 'question 2'),
        makeMessage(Role.ASSIST, 'answer 2'),
      ];
      const turns = (createMemory(history) as any).groupIntoTurns(history);
      expect(turns).toHaveLength(2);
      expect(turns[0]).toHaveLength(2);
      expect(turns[1]).toHaveLength(2);
    });

    it('跳过 system 消息', () => {
      const history = [
        makeMessage(Role.SYSTEM, 'You are helpful'),
        makeMessage(Role.USER, 'question'),
        makeMessage(Role.ASSIST, 'answer'),
      ];
      const turns = (createMemory(history) as any).groupIntoTurns(history);
      expect(turns).toHaveLength(1);
      expect(turns[0][0].role).toBe(Role.USER);
    });

    it('跳过 context user 消息', () => {
      const history = [
        makeMessage(Role.USER, 'hidden context', { kind: 'context' }),
        makeMessage(Role.USER, 'visible question'),
        makeMessage(Role.ASSIST, 'answer'),
      ];
      const turns = (createMemory(history) as any).groupIntoTurns(history);
      expect(turns).toHaveLength(1);
      expect(turns[0][0].content).toBe('visible question');
    });

    it('处理不完整 turn（user 无 assistant）', () => {
      const history = [
        makeMessage(Role.USER, 'question 1'),
        makeMessage(Role.ASSIST, 'answer 1'),
        makeMessage(Role.USER, 'pending question'),
      ];
      const turns = (createMemory(history) as any).groupIntoTurns(history);
      expect(turns).toHaveLength(2);
      expect(turns[1]).toHaveLength(1);
      expect(turns[1][0].role).toBe(Role.USER);
    });

    it('空历史', () => {
      const memory = createMemory([]);
      expect((memory as any).groupIntoTurns([])).toHaveLength(0);
    });
  });

  describe('buildContext — 过程摘要', () => {
    it('前置 meta.processSummary 到 assistant 消息（摘要在前、原文在后）', async () => {
      const history = [
        makeMessage(Role.USER, 'What is example.com?'),
        makeMessage(Role.ASSIST, 'Here is the answer', {
          processSummary: '搜索了 example.com 并总结',
        }),
      ];

      const messages = await createMemory(history).buildContext();
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
});
