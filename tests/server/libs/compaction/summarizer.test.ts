import { describe, it, expect, vi, afterEach } from 'vitest';
import { container } from 'tsyringe';
import { Summarizer } from '@/server/libs/compaction';
import { LLM_PORT } from '@/server/libs/ports/llm/llm.tokens';
import type { LlmProvider } from '@/server/libs/infrastructure/llm.provider';
import type { LlmMessage } from '@/shared/types/entities';

function makeMessages(n: number): LlmMessage[] {
  return Array.from({ length: n }, (_, i) => ({
    role: 'user',
    content: `m${i}`,
  }));
}

/** chatContent 始终返回 'summary'，并把每次 prompt 落数组以便断言滑动窗口与种子。 */
function mockLlm() {
  const prompts: string[] = [];
  const chatContent = vi.fn(
    async (_modelId: string | undefined, data: { messages: LlmMessage[] }) => {
      prompts.push(data.messages[0]?.content ?? '');
      return 'summary';
    },
  );
  return {
    chatContent,
    prompts,
    llm: {
      getDefaultModel: () => ({ id: 'test-model' }),
      chatContent,
    } as unknown as LlmProvider,
  };
}

const signal = new AbortController().signal;

// Summarizer 无状态、自容器解析 LlmProvider——测试把 mock 注册到 LLM_PORT。
afterEach(() => {
  container.clearInstances();
});

describe('Summarizer.fold', () => {
  it('prevSummary=null 且消息 ≤ 窗口：单次调用，prompt 不含[Existing summary]', async () => {
    const { chatContent, prompts, llm } = mockLlm();
    container.register(LLM_PORT, { useValue: llm });
    const s = new Summarizer();

    await s.fold(null, makeMessages(3), 10, signal);

    expect(chatContent).toHaveBeenCalledTimes(1);
    expect(prompts[0]!).not.toContain('[Existing summary]');
  });

  it('带 prevSummary：prompt 包含[Existing summary]种子', async () => {
    const { prompts, llm } = mockLlm();
    container.register(LLM_PORT, { useValue: llm });
    const s = new Summarizer();

    await s.fold('previous summary text', makeMessages(3), 10, signal);

    expect(prompts[0]!).toContain('[Existing summary]');
    expect(prompts[0]!).toContain('previous summary text');
  });

  it('消息数 > 窗口：按窗口滑动多次调用，后续块带上一块摘要', async () => {
    const { chatContent, prompts, llm } = mockLlm();
    container.register(LLM_PORT, { useValue: llm });
    const s = new Summarizer();

    await s.fold(null, makeMessages(25), 10, signal);

    // 25 / 10 = 3 块（10,10,5）
    expect(chatContent).toHaveBeenCalledTimes(3);
    // 第二块起，种子为上一块的 'summary' → prompt 含[Existing summary]
    expect(prompts[1]!).toContain('[Existing summary]');
  });

  it('空消息：直接返回 prevSummary，不调用 LLM', async () => {
    const { chatContent, llm } = mockLlm();
    container.register(LLM_PORT, { useValue: llm });
    const s = new Summarizer();

    const out = await s.fold('keep me', [], 10, signal);

    expect(chatContent).not.toHaveBeenCalled();
    expect(out).toBe('keep me');
  });
});
