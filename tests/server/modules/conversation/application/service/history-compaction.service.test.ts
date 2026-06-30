import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@/server/libs/compaction';
import '@/server/modules/agent/application/service/model-config.fragment';
import { Role } from '@/shared/entities/Message';
import type { Message } from '@/shared/types/entities';

// Summarizer 在 compact() 内部 new 出来；mock 掉以控制 fold 返回，避免真实 LLM 调用。
const { foldMock } = vi.hoisted(() => ({ foldMock: vi.fn() }));

vi.mock('@/server/libs/compaction/summarizer', () => ({
  Summarizer: vi.fn(() => ({ fold: foldMock })),
}));

import { HistoryCompactionService } from '@/server/modules/conversation/application/service/history-compaction.service';

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

// compact() 内部 new Summarizer(llm, …)；Summarizer 已 mock，llm 仅注入不被调用，故 stub 即可。
const stubLlm = {} as any;

const signal = new AbortController().signal;

// compact() 经 readConfigFragment 自取 modelId 与压缩参数——需 model + memory 片段就位。
const RUNTIME_CONFIG = {
  model: { modelId: 'openai:gpt-4' },
  memory: { compaction: { threshold: 0.8, windowSize: 10, keepRecent: 4 } },
};

function makeService() {
  return new HistoryCompactionService(stubLlm);
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
      runtimeConfig: RUNTIME_CONFIG,
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
      runtimeConfig: RUNTIME_CONFIG,
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
      messages: [msg('only-a-summary', { kind: 'compact' })],
      runtimeConfig: RUNTIME_CONFIG,
      contextSize: 100,
      signal,
    });

    expect(r).toBeNull();
    expect(foldMock).not.toHaveBeenCalled();
  });
});
