import { describe, it, expect, vi } from 'vitest';
import { Summarizer } from '@/server/modules/memory/domain/service/summarizer';
import { winstonLogger } from '@/server/utils/logger';
import type { LlmMessage } from '@/shared/types/entities';
import type { LlmPort } from '@/server/libs/ports/llm/llm.port';

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
    llm: { chatContent } as unknown as LlmPort,
  };
}

const signal = new AbortController().signal;

describe('Summarizer.fold', () => {
  it('prevSummary=null 且消息 ≤ 窗口：单次调用，prompt 不含既有摘要', async () => {
    const { chatContent, prompts, llm } = mockLlm();
    const s = new Summarizer(llm, winstonLogger, 10, 'test-model');

    await s.fold(null, makeMessages(3), signal);

    expect(chatContent).toHaveBeenCalledTimes(1);
    expect(prompts[0]!).not.toContain('既有摘要');
  });

  it('带 prevSummary：prompt 包含既有摘要种子', async () => {
    const { prompts, llm } = mockLlm();
    const s = new Summarizer(llm, winstonLogger, 10, 'test-model');

    await s.fold('previous summary text', makeMessages(3), signal);

    expect(prompts[0]!).toContain('既有摘要');
    expect(prompts[0]!).toContain('previous summary text');
  });

  it('消息数 > 窗口：按窗口滑动多次调用，后续块带上一块摘要', async () => {
    const { chatContent, prompts, llm } = mockLlm();
    const s = new Summarizer(llm, winstonLogger, 10, 'test-model');

    await s.fold(null, makeMessages(25), signal);

    // 25 / 10 = 3 块（10,10,5）
    expect(chatContent).toHaveBeenCalledTimes(3);
    // 第二块起，种子为上一块的 'summary' → prompt 含既有摘要
    expect(prompts[1]!).toContain('既有摘要');
  });

  it('空消息：直接返回 prevSummary，不调用 LLM', async () => {
    const { chatContent, llm } = mockLlm();
    const s = new Summarizer(llm, winstonLogger, 10, 'test-model');

    const out = await s.fold('keep me', [], signal);

    expect(chatContent).not.toHaveBeenCalled();
    expect(out).toBe('keep me');
  });
});
