import { describe, it, expect, vi, afterEach } from 'vitest';
import { container } from 'tsyringe';
import { fold } from '@/server/libs/compaction';
import { Prompt } from '@/server/libs/prompt';
import { LLM_PORT } from '@/server/libs/ports/llm/llm.tokens';
import type { LlmProvider } from '@/server/libs/infrastructure/llm.provider';
import type { LlmMessage } from '@/shared/types/entities';

const tpl = Prompt.empty()
  .with('Role', 'r')
  .with('Instructions', 'i')
  .with('History', '')
  .with('Output', 'o');

const signal = new AbortController().signal;

afterEach(() => {
  container.clearInstances();
});

function registerLlm(chatContent: ReturnType<typeof vi.fn>) {
  container.register(LLM_PORT, {
    useValue: {
      getDefaultModel: () => ({ id: 'compact-model' }),
      chatContent,
    } as unknown as LlmProvider,
  });
}

/** fold 发给 LLM 的 prompt 文本（第 callIdx 次调用）。 */
function sentPrompt(callIdx: number, chatContent: ReturnType<typeof vi.fn>) {
  return chatContent.mock.calls[callIdx]![1]!.messages[0]!.content as string;
}

describe('fold', () => {
  it('empty messages: returns empty string, no LLM call', async () => {
    const chatContent = vi.fn(async () => 'x');
    registerLlm(chatContent);
    expect(
      await fold({ messages: [], windowSize: 10, signal, prompt: tpl }),
    ).toBe('');
    expect(chatContent).not.toHaveBeenCalled();
  });

  it('messages ≤ window: one call; History filled with the chunk', async () => {
    const chatContent = vi.fn(async () => 'SUM');
    registerLlm(chatContent);
    const msgs: LlmMessage[] = [
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi' },
    ];

    const out = await fold({
      messages: msgs,
      windowSize: 10,
      signal,
      prompt: tpl,
    });

    expect(out).toBe('SUM');
    expect(chatContent).toHaveBeenCalledTimes(1);
    expect(sentPrompt(0, chatContent)).toContain('## History');
    expect(sentPrompt(0, chatContent)).toContain('[user]: hello');
    expect(sentPrompt(0, chatContent)).not.toContain('[previous summary]');
  });

  it('messages > window: slides chunks, threading the running summary', async () => {
    let i = 0;
    const chatContent = vi.fn(async () => `s${i++}`);
    registerLlm(chatContent);
    const msgs: LlmMessage[] = Array.from({ length: 25 }, (_, k) => ({
      role: 'user',
      content: `m${k}`,
    }));

    const out = await fold({
      messages: msgs,
      windowSize: 10,
      signal,
      prompt: tpl,
    });

    expect(chatContent).toHaveBeenCalledTimes(3);
    expect(sentPrompt(0, chatContent)).not.toContain('[previous summary]');
    expect(sentPrompt(1, chatContent)).toContain('[previous summary]: s0');
    expect(sentPrompt(2, chatContent)).toContain('[previous summary]: s1');
    expect(out).toBe('s2');
  });

  it('prior summary passed as messages[0] is folded into the history', async () => {
    const chatContent = vi.fn(async () => 'S');
    registerLlm(chatContent);
    const msgs: LlmMessage[] = [
      { role: 'user', content: 'PRIOR SUMMARY' },
      { role: 'user', content: 'new1' },
    ];

    await fold({ messages: msgs, windowSize: 10, signal, prompt: tpl });

    expect(sentPrompt(0, chatContent)).toContain('PRIOR SUMMARY');
    expect(sentPrompt(0, chatContent)).toContain('new1');
  });

  it('empty LLM output on a later chunk keeps the running summary', async () => {
    const seq = ['s0', '   '];
    const chatContent = vi.fn(async () => seq.shift() ?? '');
    registerLlm(chatContent);
    const msgs: LlmMessage[] = Array.from({ length: 15 }, (_, k) => ({
      role: 'user',
      content: `m${k}`,
    }));

    const out = await fold({
      messages: msgs,
      windowSize: 10,
      signal,
      prompt: tpl,
    });

    expect(out).toBe('s0');
  });

  it('FoldOptions.modelId 透传给 chatContent（优先于默认）', async () => {
    const chatContent: ReturnType<typeof vi.fn> = vi.fn(async () => 'SUM');
    registerLlm(chatContent);
    await fold({
      messages: [{ role: 'user', content: 'x' }],
      windowSize: 10,
      signal,
      prompt: tpl,
      modelId: 'my-compact',
    });
    expect(chatContent.mock.calls[0]![0]).toBe('my-compact');
  });

  it('未传 modelId → 回退 getDefaultModel("chat")', async () => {
    const chatContent: ReturnType<typeof vi.fn> = vi.fn(async () => 'SUM');
    registerLlm(chatContent);
    await fold({
      messages: [{ role: 'user', content: 'x' }],
      windowSize: 10,
      signal,
      prompt: tpl,
    });
    expect(chatContent.mock.calls[0]![0]).toBe('compact-model');
  });
});
