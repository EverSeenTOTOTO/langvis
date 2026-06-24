import { describe, it, expect } from 'vitest';
import { ReActMemory } from '@/server/modules/memory/application/service/react.memory';
import { Role } from '@/shared/entities/Message';
import type { Message } from '@/shared/types/entities';
import type { ReActStep } from '@/shared/types/render';

function makeMessage(
  role: Role,
  content: string,
  opts?: {
    meta?: Record<string, unknown>;
    steps?: ReActStep[];
  },
): Message {
  return {
    id: `msg_${role}_${content}`,
    role,
    content,
    attachments: null,
    meta: opts?.meta ?? null,
    steps: opts?.steps ?? null,
    createdAt: new Date(),
    conversationId: 'conv_1',
  };
}

function makeStep(
  thought: string,
  action?: {
    callId: string;
    toolName: string;
    toolArgs: Record<string, unknown>;
  },
  observation?: string,
): ReActStep {
  return {
    thought,
    action,
    observation,
    startedAt: Date.now(),
    completedAt: observation ? Date.now() + 100 : undefined,
  };
}

function createMemory(history: Message[]) {
  return new ReActMemory({
    history,
    contextSize: 8000,
    modelId: 'openai:gpt-4',
  });
}

describe('ReActMemory', () => {
  describe('buildContext', () => {
    it('should prepend step summary to assistant messages with steps', async () => {
      const step = makeStep(
        'I should search for info',
        {
          callId: 'tc_1',
          toolName: 'WebFetch',
          toolArgs: { url: 'https://example.com' },
        },
        'Page content here...',
      );

      const history = [
        makeMessage(Role.USER, 'What is example.com?'),
        makeMessage(Role.ASSIST, 'Here is the answer', { steps: [step] }),
      ];

      const memory = createMemory(history);
      const messages = await memory.buildContext();

      const assistantMsg = messages.find(m => m.role === 'assistant');
      expect(assistantMsg).toBeDefined();
      // Summary should be prepended before original content
      expect(assistantMsg!.content).toContain('思考');
      expect(assistantMsg!.content).toContain('Here is the answer');
    });

    it('should not modify assistant messages without steps', async () => {
      const history = [
        makeMessage(Role.USER, 'hello'),
        makeMessage(Role.ASSIST, 'Hi there'),
      ];

      const memory = createMemory(history);
      const messages = await memory.buildContext();

      const assistantMsg = messages.find(m => m.role === 'assistant');
      expect(assistantMsg!.content).toBe('Hi there');
    });

    it('should include all turns without truncation (no sliding window)', async () => {
      const history: Message[] = [];
      for (let i = 0; i < 15; i++) {
        history.push(makeMessage(Role.USER, `q${i}`));
        history.push(makeMessage(Role.ASSIST, `a${i}`));
      }

      const memory = createMemory(history);
      const messages = await memory.buildContext();

      // No truncation notice — full history retained until compression lands
      expect(
        messages.find(m => m.content.includes('truncated')),
      ).toBeUndefined();
      // All 15 assistant turns present (a sliding window would have dropped 10)
      expect(messages.filter(m => m.role === 'assistant')).toHaveLength(15);
    });

    it('should include system prompt and hidden messages', async () => {
      const history = [
        makeMessage(Role.SYSTEM, 'You are helpful'),
        makeMessage(Role.USER, 'session context', { meta: { hidden: true } }),
        makeMessage(Role.USER, 'visible question'),
        makeMessage(Role.ASSIST, 'answer'),
      ];

      const memory = createMemory(history);
      const messages = await memory.buildContext();

      expect(messages[0].role).toBe('system');
      const hiddenMsg = messages.find(m => m.content === 'session context');
      expect(hiddenMsg).toBeDefined();
    });

    it('should truncate observation to 100 chars in step summary', async () => {
      const longObservation = 'x'.repeat(200);
      const step = makeStep(
        'thinking',
        { callId: 'tc_1', toolName: 'Bash', toolArgs: { command: 'ls' } },
        longObservation,
      );

      const history = [
        makeMessage(Role.USER, 'run ls'),
        makeMessage(Role.ASSIST, 'Result', { steps: [step] }),
      ];

      const memory = createMemory(history);
      const messages = await memory.buildContext();

      const assistantMsg = messages.find(m => m.role === 'assistant');
      // Summary line contains truncated observation (first 100 chars)
      const summaryLine = assistantMsg!.content
        .split('\n')
        .find(l => l.includes('调用 Bash'));
      expect(summaryLine).toBeDefined();
      expect(summaryLine!.length).toBeLessThan(150); // truncated, not 200+ chars
    });

    it('should show "完成" for steps with action but no observation', async () => {
      // "完成" only appears when step.action exists but step.observation is missing
      const step = makeStep(
        'thinking',
        { callId: 'tc_1', toolName: 'Bash', toolArgs: { command: 'ls' } },
        undefined, // no observation
      );

      const history = [
        makeMessage(Role.USER, 'run ls'),
        makeMessage(Role.ASSIST, 'result', { steps: [step] }),
      ];

      const memory = createMemory(history);
      const messages = await memory.buildContext();

      const assistantMsg = messages.find(m => m.role === 'assistant');
      expect(assistantMsg!.content).toContain('完成');
    });

    it('should show only thought for steps without action', async () => {
      const step = makeStep('thinking', undefined, undefined);

      const history = [
        makeMessage(Role.USER, 'hello'),
        makeMessage(Role.ASSIST, 'answer', { steps: [step] }),
      ];

      const memory = createMemory(history);
      const messages = await memory.buildContext();

      const assistantMsg = messages.find(m => m.role === 'assistant');
      expect(assistantMsg!.content).toContain('思考: thinking');
      expect(assistantMsg!.content).not.toContain('调用');
    });

    it('should not prepend summary when steps array is empty', async () => {
      const history = [
        makeMessage(Role.USER, 'hello'),
        makeMessage(Role.ASSIST, 'answer', { steps: [] }),
      ];

      const memory = createMemory(history);
      const messages = await memory.buildContext();

      const assistantMsg = messages.find(m => m.role === 'assistant');
      expect(assistantMsg!.content).toBe('answer');
    });
  });
});
