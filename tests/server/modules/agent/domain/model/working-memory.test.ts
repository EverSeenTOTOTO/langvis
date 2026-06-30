import { describe, it, expect, vi } from 'vitest';
import '@/server/modules/agent/domain/model/loop-config.fragment';
import '@/server/modules/agent/application/service/model-config.fragment';
import { WorkingMemory } from '@/server/modules/agent/domain/model/working-memory';
import type { LoopCompactionConfig } from '@/server/modules/agent/domain/model/loop-config.fragment';

const COMPACTION_DEFAULTS: LoopCompactionConfig = {
  threshold: 0.8,
  windowSize: 10,
  keepRecent: 4,
};
const RUNTIME_CONFIG = { loop: COMPACTION_DEFAULTS };
import type { LlmPort } from '@/server/libs/ports/llm/llm.port';
import type { LlmMessage } from '@/shared/types/entities';

function mockLlm(content = 'RECAP'): LlmPort {
  return { chatContent: vi.fn(async () => content) } as unknown as LlmPort;
}

function makeWorking(
  seed: LlmMessage[],
  llm: LlmPort,
  contextSize = 10,
): WorkingMemory {
  return new WorkingMemory({
    seed,
    contextSize,
    modelId: 'openai:gpt-4',
    llm,
    runtimeConfig: RUNTIME_CONFIG,
  });
}

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

  describe('compact', () => {
    it('loop 步骤 ≤ keepRecent 时不压缩', async () => {
      const llm = mockLlm();
      const w = makeWorking([{ role: 'system', content: 'sys' }], llm);
      for (let i = 0; i < COMPACTION_DEFAULTS.keepRecent; i++)
        w.append('user', `step ${i}`);
      const r = await w.compact(new AbortController().signal);
      expect(r.compacted).toBe(false);
      expect(llm.chatContent).not.toHaveBeenCalled();
    });

    it('未超阈时不压缩', async () => {
      const llm = mockLlm();
      const w = makeWorking(
        [{ role: 'system', content: 'sys' }],
        llm,
        1_000_000,
      );
      for (let i = 0; i < 6; i++) w.append('user', `step ${i}`);
      const r = await w.compact(new AbortController().signal);
      expect(r.compacted).toBe(false);
      expect(llm.chatContent).not.toHaveBeenCalled();
    });

    it('超阈且步骤足够时折叠较早步骤、保留近期 keepRecent', async () => {
      const llm = mockLlm('THE RECAP');
      const seed: LlmMessage[] = [{ role: 'system', content: 'sys' }];
      const w = makeWorking(seed, llm, 10); // 阈值 8 token，几条消息即超
      for (let i = 0; i < 6; i++) w.append('user', `observation step ${i}`);

      const r = await w.compact(new AbortController().signal);
      expect(r.compacted).toBe(true);
      expect(llm.chatContent).toHaveBeenCalledTimes(1); // older=2 < windowSize → 单块

      const msgs = await w.buildContext();
      // seed(1) + recap(1) + keepRecent(4) = 6
      expect(msgs.length).toBe(1 + 1 + COMPACTION_DEFAULTS.keepRecent);
      expect(msgs[1]!.content).toContain('THE RECAP');
      expect(msgs[2]!.content).toContain('observation step 2'); // 保留的近期首条
      expect(w.baseLength).toBe(1); // seed 不变
    });

    it('折叠返回空时回退不压缩', async () => {
      const llm = mockLlm('   '); // trim 后为空
      const w = makeWorking([{ role: 'system', content: 'sys' }], llm, 10);
      for (let i = 0; i < 6; i++) w.append('user', `step ${i}`);
      const r = await w.compact(new AbortController().signal);
      expect(r.compacted).toBe(false);
    });
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
        chatContent: vi.fn(async () => {
          throw new Error('boom');
        }),
      } as unknown as LlmPort;
      const w = makeWorking([{ role: 'system', content: 'sys' }], llm);
      w.append('assistant', 'a');
      w.append('user', 'b');
      expect(
        await w.foldProcessSummary(new AbortController().signal),
      ).toBeNull();
    });
  });
});
