import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Role } from '@/shared/entities/Message';
import type { Message } from '@/shared/types/entities';

// Summarizer 在 compact() 内部 new 出来；mock 掉以控制 fold 返回，避免真实 LLM 调用。
const { foldMock } = vi.hoisted(() => ({ foldMock: vi.fn() }));

vi.mock('@/server/modules/memory/domain/service/summarizer', () => ({
  Summarizer: vi.fn(() => ({ fold: foldMock })),
}));

import { HistoryCompactionService } from '@/server/modules/memory/application/service/history-compaction.service';

function msg(content: string, meta?: Record<string, unknown>): Message {
  return {
    id: `msg_${content}`,
    role: Role.USER,
    content,
    attachments: null,
    meta: meta ?? null,
    createdAt: new Date(),
    conversationId: 'c1',
  };
}

// compact() 内部 `new LlmAdapter(llmProvider, modelId)`；Summarizer 已 mock，
// LlmAdapter 仅被构造不被调用，故 stub 即可。
const stubLlmProvider = {} as any;

const signal = new AbortController().signal;

function makeService() {
  return new HistoryCompactionService(stubLlmProvider);
}

describe('HistoryCompactionService.compact', () => {
  beforeEach(() => {
    foldMock.mockReset();
  });

  it('未超阈：返回 null，不调用 fold', async () => {
    foldMock.mockResolvedValue('irrelevant');
    const svc = makeService();

    const r = await svc.compact({
      messages: [msg('hi')],
      modelId: 'openai:gpt-4',
      contextSize: 100_000,
      signal,
    });

    expect(r).toBeNull();
    expect(foldMock).not.toHaveBeenCalled();
  });

  it('超阈：调用 fold 并返回 C 载荷，startRef 指向首条消息', async () => {
    foldMock.mockResolvedValue('compacted summary');
    const svc = makeService();

    const big = 'x'.repeat(2000);
    const messages = [msg(big), msg(big), msg(big)];

    const r = await svc.compact({
      messages,
      modelId: 'openai:gpt-4',
      contextSize: 100,
      signal,
    });

    expect(r).not.toBeNull();
    expect(r!.content).toBe('compacted summary');
    expect(r!.startRef).toBe(messages[0].id);
    // 首次压缩：prevSummary=null，fold tail 消息
    expect(foldMock).toHaveBeenCalledWith(null, expect.any(Array), signal);
  });

  it('tail 为空（仅有 C 无新消息）：返回 null', async () => {
    foldMock.mockResolvedValue('irrelevant');
    const svc = makeService();

    const r = await svc.compact({
      messages: [
        msg('only-a-summary', { hidden: true, kind: 'compaction_summary' }),
      ],
      modelId: 'openai:gpt-4',
      contextSize: 100,
      signal,
    });

    expect(r).toBeNull();
    expect(foldMock).not.toHaveBeenCalled();
  });
});
