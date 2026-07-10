import { describe, it, expect, vi, afterEach } from 'vitest';
import { container } from 'tsyringe';
import { WorkingMemory } from '@/server/modules/agent/domain/model/working-memory';
import type { LoopCompactionConfig } from '@/server/modules/agent/domain/model/loop-config.fragment';
import { LLM_PORT } from '@/server/libs/ports/llm/llm.tokens';
import type { LlmProvider } from '@/server/libs/infrastructure/llm.provider';
import type { LlmMessage } from '@/shared/types/entities';

const COMPACTION_DEFAULTS: LoopCompactionConfig = {
  threshold: 0.8,
  windowSize: 10,
  keepRecent: 4,
};
const RUNTIME_CONFIG = { loop: COMPACTION_DEFAULTS };

// Summarizer 现自容器解析 LlmProvider——测试把 mock 注册到 LLM_PORT。
function mockLlm(content = 'RECAP'): LlmProvider {
  return {
    getDefaultModel: () => undefined,
    chatContent: vi.fn(async () => content),
  } as unknown as LlmProvider;
}

function makeWorking(
  seed: LlmMessage[],
  llm: LlmProvider,
  contextSize = 10,
): WorkingMemory {
  container.register(LLM_PORT, { useValue: llm });
  return new WorkingMemory({
    seed,
    contextSize,
    runtimeConfig: RUNTIME_CONFIG,
  });
}

afterEach(() => {
  container.clearInstances();
});

describe('WorkingMemory', () => {
  it('buildContext 返回种子；baseLength = 种子长度', async () => {
    const seed: LlmMessage[] = [{ role: 'system', content: 'sys' }];
    const w = makeWorking(seed, mockLlm());
    expect((await w.buildContext()).length).toBe(1);
    expect(w.baseLength).toBe(1);
  });

  it('append 增长迭代消息', async () => {
    const w = makeWorking([{ role: 'system', content: 'sys' }], mockLlm());
    w.append('user', 'q1');
    w.append('assistant', 'a1');
    expect((await w.buildContext()).length).toBe(3);
    expect(w.baseLength).toBe(1);
  });

  describe('foldProcessSummary', () => {
    it('步骤 ≤1 时跳过（trivial turn）', async () => {
      const llm = mockLlm();
      const w = makeWorking([{ role: 'system', content: 'sys' }], llm);
      w.append('assistant', 'direct answer');
      expect(
        await w.foldProcessSummary(new AbortController().signal),
      ).toBeNull();
      expect(llm.chatContent).not.toHaveBeenCalled();
    });

    it('步骤 >1 时折叠为过程摘要', async () => {
      const llm = mockLlm('THE SUMMARY');
      const w = makeWorking([{ role: 'system', content: 'sys' }], llm);
      w.append('assistant', 'thought+action');
      w.append('user', 'observation');
      w.append('assistant', 'final');
      expect(await w.foldProcessSummary(new AbortController().signal)).toBe(
        'THE SUMMARY',
      );
    });

    it('折叠异常时返回 null', async () => {
      const llm = {
        getDefaultModel: () => undefined,
        chatContent: vi.fn(async () => {
          throw new Error('boom');
        }),
      } as unknown as LlmProvider;
      const w = makeWorking([{ role: 'system', content: 'sys' }], llm);
      w.append('assistant', 'a');
      w.append('user', 'b');
      expect(
        await w.foldProcessSummary(new AbortController().signal),
      ).toBeNull();
    });
  });
});
